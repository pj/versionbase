/// <reference path="../typings/index.d.ts" />
/// <reference path="../typings/auto.d.ts" />
/// <reference path="./manual.d.ts" />
import {Server as WebSocketServer} from 'ws';
import * as database from './database';
import {Map} from "immutable";

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
            let result = database.get_item(snapshots, message.item_id, message.version_id,
                                      message.transaction_id || "current");
            return [snapshots, result];
        case "update":
            return [database.update_item(snapshots, message.item_id,
                                    message.version_id,
                                    message.transaction_id || "current",
                                    message.data), null];
        case "delete":
            return [database.delete_item(snapshots, message.item_id,
                                    message.version_id,
                                    message.transaction_id || "current"), null];
        case "create":
            return database.create_item(snapshots,
                                   message.version_id,
                                   message.transaction_id || "current",
                                   message.data);
        case "find":
            return database.find_items(snapshots,
                                 message.project,
                                 message.select,
                                 message.reduce,
                                 message.version_id,
                                 message.transaction_id || "current");
        // start transaction.
        case "begin":
            return database.begin_transaction(snapshots, message.snapshot_id || "current");
        // commit transaction.
        case "commit":
            return [database.commit_transaction(snapshots, message.transaction_id), null];
        // rollback transaction.
        case "rollback":
            return [database.rollback_transaction(snapshots, message.transaction_id), null];
        case "create_snapshot":
            return database.create_snapshot(snapshots, message.snapshot_id || "current");
        case "delete_snapshot":
            return [database.delete_snapshot(snapshots, message.snapshot_id), null];
        // add a new git version to current snapshot.
        case "create_version":
            if (message.commit_id === undefined || message.commit_id === null) {
                throw new Error("No commit id supplied");
            };
            return [database.create_version(snapshots, message.commit_id,
                                            message.parent_commit_id), null];
        case "version_exists":
            if (message.commit_id === undefined || message.commit_id === null) {
                throw new Error("No commit id supplied");
            };
            return database.version_exists(snapshots, message.commit_id);
        }
}

function process_message(ws, state, message) {
    if (message.transaction_id) {
        state.current_transaction_id = message.transaction_id;
    }
    try {
        let [new_snapshots, result] = dispatch_message(state.transshots, message);
        state.transshots = new_snapshots;
        let response = generate_result(result, message.message_id);
        console.log("response: " + response);
        ws.send(response);
    } catch(e) {
        console.error(e);
        ws.close(1011, generate_result(e.stack, 1, e.toString()))
    }
}

export function handle_message(ws, state, raw_message) {
    let message = JSON.parse(raw_message);
    if (state.current_transaction_id === null || (message.transaction_id && message.transaction_id === state.current_transaction_id)) {
        process_message(ws, state, message);
    } else {
        let times = 0;
        let transaction_interval = setInterval(function (){
            if (state.current_transaction_id === null) {
                process_message(ws, state, message);
            } else if(times > 5) {
                ws.close(1013, "Timed out waiting for transaction to complete");
            } else {
                times += 1;
            }
        }, 100);
    }
}

export function create_server(port=9876) {
    let state = {
        current_transaction_id: null,
        transshots: Map()
    }
    const wss = new WebSocketServer({ port: port });
    wss.on('connection', function connection(ws) {
        console.log("connected to client");
        ws.on('message', function (raw_message) {
            console.log("message received: " + raw_message);
            handle_message(ws, state, raw_message);
        });

        ws.on('error', function (error) {
            console.error(error);
        });

        ws.on('close', function (code, message) {
            if (code != 1000) {
                console.error(`connection closed with error: ${code} ${message}`);
            } else {
                //ws.close(1000, JSON.stringify({message_id: }));
                console.log(`connection closed with: ${code} ${message}`);
            }
        });
    });

    wss.on('error', function (error){
        console.error(error);
    });
    console.log("Listening on " + port);
}
