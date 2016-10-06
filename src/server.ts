/// <reference path="../typings/index.d.ts" />
/// <reference path="../typings/auto.d.ts" />
/// <reference path="./manual.d.ts" />
import {Server as WebSocketServer} from 'ws';
import * as database from './database';
import {Map} from "immutable";
import * as winston from "winston";

function generate_result(result, message_id, status=0, message="") {
    return JSON.stringify({
        status: status,
        message: message,
        message_id: message_id,
        result: result
    });
}

function dispatch_message(snapshots, message) {
    switch (message.operation) {
        case "get":
            return database.get_item(snapshots,
                                     message.item_id,
                                     message.version_id,
                                     message.transaction_id || "current");
        case "update":
            return database.update_item(snapshots, message.item_id,
                                    message.version_id,
                                    message.transaction_id || "current",
                                    message.data);
        case "delete":
            return database.delete_item(snapshots, message.item_id,
                                    message.version_id,
                                    message.transaction_id || "current");
        case "create":
            return database.create_item(snapshots,
                                   message.version_id,
                                   message.transaction_id || "current",
                                   message.data);
        case "find":
            return database.find_items(snapshots,
                                 message.version_id,
                                 message.transaction_id || "current",
                                 message.select || null,
                                 message.filter || null);
        // start transaction.
        case "begin":
            return database.begin_transaction(snapshots,
                                              message.snapshot_id || "current");
        // commit transaction.
        case "commit":
            return database.commit_transaction(snapshots,
                                               message.transaction_id);
        // rollback transaction.
        case "rollback":
            return database.rollback_transaction(snapshots,
                                                 message.transaction_id);
        case "create_snapshot":
            return database.create_snapshot(snapshots,
                                            message.snapshot_id || "current");
        case "delete_snapshot":
            return database.delete_snapshot(snapshots, message.snapshot_id);
        // add a new git version to current snapshot.
        case "create_version":
            if (message.commit_id === undefined || message.commit_id === null) {
                throw new Error("No commit id supplied");
            };
            //if (message.parents === undefined || message.parents === null
                //|| !Array.isArray(message.parents)) {
                //throw new Error("Commit parents not present or not an array.");
            //};
            return database.create_version(snapshots,
                                           message.commit_id,
                                           message.data_parent_id || null,
                                           message.parents || null);
        case "version_exists":
            if (message.commit_id === undefined || message.commit_id === null) {
                throw new Error("No commit id supplied");
            };
            return database.version_exists(snapshots, message.commit_id);
        case "set_all_version_items":
            if (message.source_commit_id === undefined || message.source_commit_id === null) {
                throw new Error("No source commit id supplied");
            };
            if (message.destination_commit_id === undefined || message.destination_commit_id === null) {
                throw new Error("No destination commit id supplied");
            };
            return database
                .set_all_version_items(snapshots,
                                       message.source_snapshot_id || "current",
                                       message.destination_snapshot_id || "current",
                                       message.source_commit_id,
                                       message.destination_commit_id)
        case "copy_version_items":
            if (message.source_commit_id === undefined || message.source_commit_id === null) {
                throw new Error("No source commit id supplied");
            };
            if (message.destination_commit_id === undefined || message.destination_commit_id === null) {
                throw new Error("No destination commit id supplied");
            };
            if (message.item_ids === undefined || message.item_ids === null
                || !Array.isArray(message.item_ids)) {
                throw new Error("Item ids must be present and an array");
            };
            return database
                .copy_version_items(snapshots,
                                       message.source_snapshot_id || "current",
                                       message.destination_snapshot_id || "current",
                                       message.source_commit_id,
                                       message.destination_commit_id,
                                       message.source_ids,
                                       message.replace || false);
        }
}

export function handle_message(ws, transshots, raw_message) {
    try {
        let message = JSON.parse(raw_message);
        winston.log('silly', "Request message", message);
        let [new_snapshots, result] = dispatch_message(transshots, message);
        let response = generate_result(result, message.message_id);
        winston.log('silly', "Response message", response)
        ws.send(response);
        return new_snapshots;
    } catch(e) {
        winston.error("database error", e)
        ws.close(1011, generate_result(e.stack, 1, e.toString()))
    }
}

export function create_server(port=9876) {
    let transshots = Map();
    const wss = new WebSocketServer({ port: port });
    wss.on('connection', function connection(ws) {
        winston.debug("connected to client");
        ws.on('message', function (raw_message) {
            transshots = handle_message(ws, transshots, raw_message);
        });

        ws.on('error', function (error) {
            winston.error("database error", error);
        });

        ws.on('close', function (code, message) {
            if (code != 1000) {
                winston.error(`connection closed with error: ${code} ${message}`);
            } else {
                winston.debug(`connection closed with: ${code} ${message}`);
            }
        });
    });

    wss.on('error', function (error){
        winston.error('Web socket server error', error);
    });
    winston.debug("Listening on " + port);
}
