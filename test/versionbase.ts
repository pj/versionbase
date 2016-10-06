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
import * as winston from "winston";

var pi = require("pretty-immutable");

winston.level = "error";
class ServerMocket {
    received_messages: any
    constructor() {
        this.received_messages = [];
    }

    send(message) {
        this.received_messages.push(message);
    }

    close(code, message) {

    }

    get_received_messages() {
        return this.received_messages;
    }
}

function test_message_send(transshots, messages, responses) {
    let socket = new ServerMocket();
    let socket_mock = sinon.mock(socket);
    if (responses instanceof Array) {
        for (let response of responses) {
            socket_mock.expects("send")
                .once()
                .withArgs(JSON.stringify(response));
        }
    } else {
        responses(socket_mock);
    }

    for (let message of messages) {
        transshots = handle_message(socket, transshots, JSON.stringify(message));
    }

    socket_mock.verify();

    return [transshots, socket];
}

describe("the versionbase server", function () {
    it("should create data", function () {
        let _;
        let transshots = Map();

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

        var second_response_message = {
            status: 0,
            message: "",
            message_id: "bar"
        }

        // DELETE THIS AND IT WILL FAIL!
        console.log;

        [transshots, _] = test_message_send(transshots,
                                            [first_request_message, second_request_message],
                          function (socket_mock) {
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
                          });
    });
});
