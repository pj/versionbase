/// <reference path="../typings/index.d.ts" />
/// <reference path="../typings/auto.d.ts" />
/// <reference path="../src/manual.d.ts" />
import * as chai from "chai";
var chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
var assert:any = chai.assert;

import * as database from "../src/database";
import {handle_message} from "../src/server";
import {Connection} from "../src/client";
import {Map} from "immutable";
import * as sinon from "sinon";
import * as events from "events";

describe("the versionbase core logic", function () {
    it("should create a version tree", function () {
        let transshots = Map<string, Map<string, any>>();
        transshots = database.create_version(transshots, "A", null);
        assert.equal(transshots.size, 1);
        transshots = database.create_version(transshots, "B", "A");
        transshots = database.create_version(transshots, "C", "A");
        transshots = database.create_version(transshots, "D", "C");
        assert.equal(transshots.get("current").size, 4);

        let version = transshots.get("current").get("D");
        assert.equal(version.parent.version_id, "C");
        assert.equal(version.parent.parent.version_id, "A");

        version = transshots.get("current").get("B");
        assert.equal(version.parent.version_id, "A");
        version = transshots.get("current").get("A");
        assert.isNull(version.parent);
    });

    it("should CRUD items", function () {
        let new_id, data;
        let transshots = Map<string, Map<string, any>>();
        transshots = database.create_version(transshots, "A", null);
        transshots = database.create_version(transshots, "B", "A");
        assert.equal(transshots.get("current").size, 2);

        [transshots, new_id] = database.create_item(transshots, "B", "current", {message: "hello"});

        assert.isNotNull(new_id);
        let current = transshots.get("current");
        assert.equal(current.get("A").items.size, 0);
        assert.equal(current.get("B").items.size, 1);

        data = database.get_item(transshots, new_id, "B", "current");
        assert.equal(data.message, "hello");
        assert.equal(data.id, new_id);
        assert.equal(data.version, "B");
        data = database.get_item(transshots, "asdf", "B", "current");
        assert.isNull(data);
        data = database.get_item(transshots, new_id, "A", "current");
        assert.isNull(data);

        [transshots, new_id] = database.create_item(transshots, "A", "current", {message: "foo"});
        transshots = database.update_item(transshots, new_id, "B", "current", {message: "bar"});
        data = database.get_item(transshots, new_id, "A", "current");
        assert.equal(data.message, "foo");
        assert.equal(data.id, new_id);
        assert.equal(data.version, "A");
        data = database.get_item(transshots, new_id, "B", "current");
        assert.equal(data.message, "bar");
        assert.equal(data.id, new_id);
        assert.equal(data.version, "B");

        transshots = database.delete_item(transshots, new_id, "B", "current");
        data = database.get_item(transshots, new_id, "A", "current");
        assert.equal(data.message, "foo");
        assert.equal(data.id, new_id);
        assert.equal(data.version, "A");
        data = database.get_item(transshots, new_id, "B", "current");
        assert.isNull(data);
    });

    it("should find some items", function () {
    });

    it("should reduce some items", function () {
    });
});

describe("versionbase transaction", function () {
    function common_transaction() {
        let first_id, second_id, data, transaction_id;
        let transshots = Map<string, Map<string, any>>();
        transshots = database.create_version(transshots, "A", null);
        transshots = database.create_version(transshots, "B", "A");
        assert.equal(transshots.get("current").size, 2);

        [transshots, transaction_id] = database.begin_transaction(transshots, "current");
        [transshots, first_id] = database.create_item(transshots, "B",
                                                      transaction_id, {message: "foo"});
        [transshots, second_id] = database.create_item(transshots, "B",
                                                       transaction_id, {message: "bar"});

        transshots = database.delete_item(transshots, first_id, "B", transaction_id);
        transshots = database.update_item(transshots, second_id, "B",
                                          transaction_id, {message: "baz"});

        data = database.get_item(transshots, first_id, "B", transaction_id);
        assert.isNull(data);
        data = database.get_item(transshots, second_id, "B", transaction_id);
        assert.equal(data.message, "baz");
        assert.equal(data.id, second_id);
        assert.equal(data.version, "B");

        // check that current isn't modified.
        assert.equal(transshots.get("current").size, 2);
        assert.equal(transshots.get("current").get("B").items.size, 0);

        return [transshots, first_id, second_id, transaction_id];
    };

    it("should apply transaction", function () {
        let [transshots, first_id, second_id, transaction_id] = common_transaction();
        transshots = database.commit_transaction(transshots, transaction_id);
        // now checkout
        let data = database.get_item(transshots, first_id, "B", "current");
        assert.isNull(data);
        data = database.get_item(transshots, second_id, "B", "current");
        assert.equal(data.message, "baz");
        assert.equal(data.id, second_id);
        assert.equal(data.version, "B");
    });

    it("should rollback transaction", function () {
        let [transshots, first_id, second_id, transaction_id] = common_transaction();
        transshots = database.rollback_transaction(transshots, transaction_id);
        // now checkout
        let data = database.get_item(transshots, first_id, "B", "current");
        assert.isNull(data);
        data = database.get_item(transshots, second_id, "B", "current");
        assert.isNull(data);
        assert.equal(transshots.get("current").size, 2);
        assert.equal(transshots.get("current").get("B").items.size, 0);
    });

    it("should reject transaction when current modified", function () {
        let third_id;
        let [transshots, first_id, second_id, transaction_id] = common_transaction();

        [transshots, third_id] = database.create_item(transshots, "B",
                                                      "current", {message: "foo"});

        assert.throws(function () {
            database.commit_transaction(transshots, transaction_id);
        }, "Concurrent updates not allowed!");
    });
});

describe("versionbase snapshots", function () {
    it("should leave snapshot unmodified after creation", function () {
        let first_id, second_id, data, snapshot_id;
        let transshots = Map<string, Map<string, any>>();
        transshots = database.create_version(transshots, "A", null);
        transshots = database.create_version(transshots, "B", "A");
        assert.equal(transshots.get("current").size, 2);

        [transshots, first_id] = database.create_item(transshots, "B",
                                                      "current", {message: "foo"});
        [transshots, second_id] = database.create_item(transshots, "B",
                                                       "current", {message: "bar"});

        [transshots, snapshot_id] = database.create_snapshot(transshots, "current");

        transshots = database.delete_item(transshots, first_id, "B", "current");
        transshots = database.update_item(transshots, second_id, "B",
                                          "current", {message: "baz"});
        data = database.get_item(transshots, first_id, "B", "current");
        assert.isNull(data);
        data = database.get_item(transshots, second_id, "B", "current");
        assert.equal(data.message, "baz");
        assert.equal(data.id, second_id);
        assert.equal(data.version, "B");

        data = database.get_item(transshots, first_id, "B", snapshot_id);
        assert.isNotNull(data);
        assert.equal(data.message, "foo");
        assert.equal(data.id, first_id);
        assert.equal(data.version, "B");
        data = database.get_item(transshots, second_id, "B", snapshot_id);
        assert.equal(data.message, "bar");
        assert.equal(data.id, second_id);
        assert.equal(data.version, "B");
    });

    it("should leave current unmodified after snapshot deleted", function () {
        let first_id, second_id, data, snapshot_id;
        let transshots = Map<string, Map<string, any>>();
        transshots = database.create_version(transshots, "A", null);
        transshots = database.create_version(transshots, "B", "A");
        assert.equal(transshots.get("current").size, 2);

        [transshots, first_id] = database.create_item(transshots, "B",
                                                      "current", {message: "foo"});
        [transshots, second_id] = database.create_item(transshots, "B",
                                                       "current", {message: "bar"});

        [transshots, snapshot_id] = database.create_snapshot(transshots, "current");
        transshots = database.delete_snapshot(transshots, snapshot_id);

        data = database.get_item(transshots, first_id, "B", "current");
        assert.equal(data.message, "foo");
        assert.equal(data.id, first_id);
        assert.equal(data.version, "B");
        data = database.get_item(transshots, second_id, "B", "current");
        assert.equal(data.message, "bar");
        assert.equal(data.id, second_id);
        assert.equal(data.version, "B");
    });

    it("should leave snapshot unmodified after transaction", function () {
        let first_id, second_id, data, snapshot_id, transaction_id;
        let transshots = Map<string, Map<string, any>>();
        transshots = database.create_version(transshots, "A", null);
        transshots = database.create_version(transshots, "B", "A");
        assert.equal(transshots.get("current").size, 2);

        [transshots, first_id] = database.create_item(transshots, "B",
                                                      "current", {message: "foo"});
        [transshots, second_id] = database.create_item(transshots, "B",
                                                       "current", {message: "bar"});

        [transshots, snapshot_id] = database.create_snapshot(transshots, "current");

        [transshots, transaction_id] = database.begin_transaction(transshots, snapshot_id);

        transshots = database.delete_item(transshots, first_id, "B", transaction_id);
        transshots = database.update_item(transshots, second_id, "B", transaction_id, {message: "baz"});
        transshots = database.commit_transaction(transshots, transaction_id);

        data = database.get_item(transshots, first_id, "B", "current");
        assert.isNull(data);
        data = database.get_item(transshots, second_id, "B", "current");
        assert.equal(data.message, "baz");
        assert.equal(data.id, second_id);
        assert.equal(data.version, "B");

        data = database.get_item(transshots, first_id, "B", snapshot_id);
        assert.isNotNull(data);
        assert.equal(data.message, "foo");
        assert.equal(data.id, first_id);
        assert.equal(data.version, "B");
        data = database.get_item(transshots, second_id, "B", snapshot_id);
        assert.equal(data.message, "bar");
        assert.equal(data.id, second_id);
        assert.equal(data.version, "B");
    });
});

class Mocket {
    responses: any;
    current_response: any;
    close_message:any;
    close_code: any;
    events: any;
    constructor (responses, close_message, close_code) {
        this.responses = responses;
        this.current_response = 0;
        this.close_message = close_message;
        this.close_code = close_code;
        this.events = {};
    }

    on(event, callback) {
        if (event === "open") {
            callback();
        }
        this.events[event] = callback;
    }

    send(message) {
        this.events["message"](this.responses[this.current_response]);
        this.current_response++;
    }

    close(close, message) {
        this.events["close"](this.close_code, this.close_message);
    }

    message_ids() {
        let message_ids = ["open"];
        this.responses.forEach(r => message_ids.push(JSON.parse(r).message_id));
        message_ids.push(JSON.parse(this.close_message).message_id);
        return message_ids;
    }
}

class MockConnection extends Connection {
    static socket: any
    message_ids: Array<string>
    current_id: number
    static create_socket(url, port) {
        return this.socket;
    }

    create_message_id() {
        this.current_id++;
        return this.message_ids[this.current_id];
    }

    constructor(socket) {
        super(socket);
        this.message_ids = socket.message_ids();
        this.current_id = -1;
    }

    static mock_connect(responses, close_message, close_code) {
        this.socket = new Mocket(responses, close_message, close_code);
        return this.connect();
    }
}

describe("the versionbase client", function () {
    it("should connect and disconnect", function () {
        async function connect_disconnect() {
            let connection = await MockConnection.mock_connect([],
                       `{"message_id": "end", "result": "everything is good"}`,
                        1000);

            return connection.disconnect();
        }

        return assert.eventually.equal(connect_disconnect(), "everything is good");
    });

    it("should begin and commit", function () {
        process.env.LAZY_CLOUD_COMMIT_ID = "hello";
        async function transact() {
            let connection = await MockConnection.mock_connect(
                [`{"message_id": "begin", "result": null}`,
                 `{"message_id": "commit", "result": null}` ],
                       `{"message_id": "end", "result": "everything is good"}`,
                        1000);
            await connection.begin();
            await connection.commit();
            return connection.disconnect();
        }

        return assert.eventually.equal(transact(), "everything is good");
    });

    it("should begin and rollback", function () {
        process.env.LAZY_CLOUD_COMMIT_ID = "hello";
        async function transact() {
            let connection = await MockConnection.mock_connect(
                [`{"message_id": "begin", "result": null}`,
                 `{"message_id": "rollback", "result": null}` ],
                `{"message_id": "end", "result": "everything is good"}`,
                1000);
            await connection.begin();
            await connection.rollback();
            return connection.disconnect();
        }

        return assert.eventually.equal(transact(), "everything is good");
    });
});

class ServerMocket {
    send(message) {

    }

    close(code, message) {

    }
}

describe("the versionbase server", function () {
    it("should create versions", function () {
        let state = {
            current_transaction_id: null,
            transshots: Map()
        };

        let first_request_message = {
            operation: "create_version",
            message_id: "foo",
            commit_id: "A"
        }

        let second_request_message = {
            operation: "create_version",
            message_id: "bar",
            commit_id: "B",
            parent_commit_id: "A"
        }

        let first_response_message = {
            status: 0,
            message: "",
            message_id: "foo",
            result: null
        }

        let second_response_message = {
            status: 0,
            message: "",
            message_id: "bar",
            result: null
        }

        let socket = new ServerMocket();
        let socket_mock = sinon.mock(socket);
        socket_mock.expects("send")
            .once()
            .withArgs(JSON.stringify(first_response_message))
        socket_mock.expects("send")
            .once()
            .withArgs(JSON.stringify(second_response_message));

        handle_message(socket, state, JSON.stringify(first_request_message));
        handle_message(socket, state, JSON.stringify(second_request_message));

        socket_mock.verify();
    });

    it("should reject non-existent parent version", function () {
        let state = {
            current_transaction_id: null,
            transshots: Map()
        };

        let first_request_message = {
            operation: "create_version",
            message_id: "foo",
            commit_id: "B",
            parent_commit_id: "A"
        }

        let first_response_message = {
            status: 0,
            message: "",
            message_id: "foo",
            result: null
        }

        let socket = new ServerMocket();
        let socket_mock = sinon.mock(socket);
        let asdf = socket_mock.expects("close")
            .once()
            .withArgs(1011);

        handle_message(socket, state, JSON.stringify(first_request_message));

        socket_mock.verify();
    });

    it("should get data", function () {
        let state = {
            current_transaction_id: null,
            transshots: Map()
        };
        let transshots, item_id;
        transshots = database.create_version(state.transshots, "A", null);
        [transshots, item_id] = database.create_item(transshots, "A",
                                                     "current", {"hello": "world"});

        state.transshots = transshots;

        let first_request_message = {
            operation: "get",
            message_id: "foo",
            version_id: "A",
            item_id: item_id
        }

        let first_response_message = {
            status: 0,
            message: "",
            message_id: "foo",
            result: {hello: "world",
                     id: item_id,
                     version: "A"}
        }

        let socket = new ServerMocket();
        let socket_mock = sinon.mock(socket);
        socket_mock.expects("send")
            .once()
            .withArgs(JSON.stringify(first_response_message));

        handle_message(socket, state, JSON.stringify(first_request_message));

        socket_mock.verify();
    });

    it("should create data", function () {
        let state = {
            current_transaction_id: null,
            transshots: Map()
        };

        let first_request_message = {
            operation: "create_version",
            message_id: "foo",
            commit_id: "A"
        }

        let second_request_message = {
            operation: "create",
            message_id: "bar",
            version_id: "A",
            data: {hello: "world"}
        }

        let first_response_message = {
            status: 0,
            message: "",
            message_id: "foo",
            result: null
        }

        let second_response_message = {
            status: 0,
            message: "",
            message_id: "bar",
        }

        let socket = new ServerMocket();
        let socket_mock = sinon.mock(socket);
        socket_mock.expects("send")
            .once()
            .withArgs(JSON.stringify(first_response_message))
        socket_mock.expects("send")
            .once()
            .withArgs(
                sinon.match(function (value) {
                    let json_value = JSON.parse(value);

                    return json_value["status"] === second_response_message["status"] &&
                        json_value["message"] === second_response_message["message"] &&
                        json_value["message_id"] === second_response_message["message_id"] &&
                        json_value.result;
                })
            );

        handle_message(socket, state, JSON.stringify(first_request_message));
        handle_message(socket, state, JSON.stringify(second_request_message));

        socket_mock.verify();

        assert.equal(state.transshots.getIn(["current", "A", "items"]).size, 1);
    });

    it("should delete data", function () {
        let state = {
            current_transaction_id: null,
            transshots: Map()
        };
        let transshots, item_id;
        transshots = database.create_version(state.transshots, "A", null);
        [transshots, item_id] = database.create_item(transshots, "A",
                                                     "current", {"hello": "world"});

        state.transshots = transshots;

        let first_request_message = {
            operation: "delete",
            message_id: "foo",
            version_id: "A",
            item_id: item_id
        }

        let first_response_message = {
            status: 0,
            message: "",
            message_id: "foo",
            result: null
        }

        let socket = new ServerMocket();
        let socket_mock = sinon.mock(socket);
        socket_mock.expects("send")
            .once()
            .withArgs(JSON.stringify(first_response_message));

        handle_message(socket, state, JSON.stringify(first_request_message));

        socket_mock.verify();
    });

    it("should update data", function () {
        let state = {
            current_transaction_id: null,
            transshots: Map()
        };
        let transshots, item_id;
        transshots = database.create_version(state.transshots, "A", null);
        [transshots, item_id] = database.create_item(transshots, "A",
                                                     "current", {"hello": "world"});

        state.transshots = transshots;

        let first_request_message = {
            operation: "update",
            message_id: "foo",
            version_id: "A",
            item_id: item_id,
            data: {"hello": "paul"}
        }

        let first_response_message = {
            status: 0,
            message: "",
            message_id: "foo",
            result: null
        }

        let socket = new ServerMocket();
        let socket_mock = sinon.mock(socket);
        socket_mock.expects("send")
            .once()
            .withArgs(JSON.stringify(first_response_message));

        handle_message(socket, state, JSON.stringify(first_request_message));

        socket_mock.verify();
    });

    it("should apply two transactions in order.", function () {

    });

    it("should time a transaction out if current transaction isn't changed.", function () {

    });
});

// Integration test.
//describe.skip("the versionbase server", function () {
    //it("should something", function () {

    //});
//});
