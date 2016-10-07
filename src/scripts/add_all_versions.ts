#!/usr/bin/env node --harmony
import {Connection} from '../client';
import * as utils from '../utils';

async function do_stuff() {
    let connection = await Connection.connect();
    let output: any = await utils.exec(`git --no-pager log --all --format="%H %P"`);
    let lines = output[0].split("\n");
    lines.reverse();
    for (let line of lines) {
        let [commit_id, ...parents] = line.split(" ");
        let version_exists = await connection.version_exists(commit_id);
        if (!version_exists) {
            await connection.create_version(commit_id, parents);
        }
    }
    await connection.disconnect();
}

do_stuff()
    .then(_ => console.log("added all versions"))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
