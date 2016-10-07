/// <reference path="../typings/index.d.ts" />
/// <reference path="../typings/auto.d.ts" />
/// <reference path="./manual.d.ts" />
let WebSocket = require('ws');
let uuid = require('uuid');
let q = require('q');

export class Connection {
    ws: any
    active_defereds: any
    transaction_id: any

    constructor(ws) {
        this.ws = ws;
        this.active_defereds = {};
        this.transaction_id = null;
    }

    create_message_id() {
        return uuid.v4();
    }

    createPromise() {
        let deferred_id = this.create_message_id();

        let deferred = q.defer();
        this.active_defereds[deferred_id] = deferred;

        return [deferred_id, deferred.promise];
    }

    // separated this out to make it easier to mock the socket.
    static create_socket(url, port) {
        return new WebSocket(`ws://${url}:${port}`);
    }

    static bailout(connection, error) {
        for (let k in connection.active_defereds) {
            if (connection.active_defereds.hasOwnProperty(k)) {
                connection.active_defereds[k].reject(error);
            }
        }
    }

    static connect(url = "localhost", port=9876) {
        let ws = this.create_socket(url, port);

        let connection = new this(ws);
        let [connection_id, connection_promise] = connection.createPromise();

        ws.on("open", function() {
            connection.active_defereds[connection_id].resolve(connection);
        });

        ws.on("message", function (raw_message){
            let message = JSON.parse(raw_message);

            if (message.hasOwnProperty("message_id")) {
                let message_deferred = connection.active_defereds[message.message_id];

                if (message_deferred) {
                    message_deferred.resolve(message.result);
                    delete connection.active_defereds[message.message_id];
                } else {
                    Connection.bailout(connection, new Error("Server sent a response with a message_id that doesn't exist."));
                }
            } else {
                Connection.bailout(connection, new Error("Server sent a response without a message_id."));
            }
        });

        ws.on("close", function (code, raw_message) {
            if (code === 1000) {
                try {
                    let message = JSON.parse(raw_message);
                    if (message.hasOwnProperty("message_id")) {
                        let message_deferred = connection.active_defereds[message.message_id];

                        if (message_deferred) {
                            message_deferred.resolve(message.result);
                            delete connection.active_defereds[message.message_id];
                        } else {
                            Connection.bailout(connection, new Error("Server sent a response with a message_id that doesn't exist."));
                        }
                    } else {
                        Connection.bailout(connection, new Error("Server sent a response without a message_id."));
                    }
                } catch (e) {
                    Connection.bailout(connection, e);
                }
            } else {
                Connection.bailout(connection, new Error(`code: ${code} message: ${raw_message}`));
            }
        });

        ws.on("error", function (error) {
            Connection.bailout(connection, error);
        });

        return connection_promise;
    }

    disconnect() {
        let [message_id, promise] = this.createPromise();
        this.ws.close(1000, JSON.stringify({message_id: message_id, operation: "close"}));
        return promise;
    }

    sendRequest(operation, values, needs_commit_id=true) {
        let [message_id, promise] = this.createPromise();
        let message: any = {message_id: message_id, operation: operation};
        if (needs_commit_id) {
             if (process.env.LAZY_CLOUD_COMMIT_ID) {
                message.version_id = process.env.LAZY_CLOUD_COMMIT_ID;
            } else {
                throw new Error("LAZY_CLOUD_COMMIT_ID environment variable must be set.");
            }
        }
        if (this.transaction_id) {
            message.transaction_id = this.transaction_id;
        }
        Object.assign(message, values);
        this.ws.send(JSON.stringify(message));
        return promise;
    }

    get(item_id) {
        return this.sendRequest("get", {item_id: item_id});
    }

    create(data) {
        return this.sendRequest("create", {data: data});
    }

    update(item_id, data) {
        return this.sendRequest("update", {item_id: item_id, data: data});
    }

    delete(item_id) {
        return this.sendRequest("delete", {item_id: item_id});
    }

    find(select, filter) {
        return this.sendRequest("find", {select: select, filter: filter});
    }

    async begin(snapshot_id) {
        if (this.transaction_id) {
            throw new Error("Transaction already started.");
        }
        var message: any;
        if (snapshot_id) {
            message = {snapshot_id: snapshot_id};
        } else {
            message = {};
        }
        this.transaction_id = await this.sendRequest("begin", message);
        return this.transaction_id;
    }

    async commit() {
        await this.sendRequest("commit", {});
        this.transaction_id = null;
        return null;
    }

    async rollback() {
        await this.sendRequest("rollback", {});
        this.transaction_id = null;
        await Promise.resolve();
    }

    async transact(func, snapshot_id) {
        await this.begin(snapshot_id);

        try {
            await func();
            await this.commit();
        } catch (e) {
            await this.rollback();
            throw e;
        }
    }

    snapshot() {
        return this.sendRequest("create_snapshot", {});
    }

    delete_snapshot(snapshot_id) {
        return this.sendRequest("delete_snapshot", {snapshot_id: snapshot_id});
    }

    create_version(commit_id:string, parent_commits: string[], data_parent_id?: string) {
        let message;
        if (parent_commits) {
            message = {commit_id: commit_id, parents: parent_commits};
        } else {
            message = {commit_id: commit_id};
        }
        return this.sendRequest("create_version", message, false);
    }

    version_exists(commit_id) {
        return this.sendRequest("version_exists", {commit_id: commit_id}, false);
    }
}
