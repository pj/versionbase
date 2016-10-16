#!/usr/bin/env node
import * as program from 'commander';
import {create_server} from './server';
var winston = require('winston');

let _program: any = program;

_program
    .version('0.0.1')
    .option("-p, --port <n>", "Port for proxy server", parseInt, 9876)
    .option("-d, --debug", "Set debug logging", false)
    .option("-v, --verbose", "Set verbose logging", false)
    .option("-q, --quiet", "Suppress output", false)
    .option("-f, --file [f]", "name of file to store data in", "versionbase.db")
    .parse(process.argv);

if (_program.debug) {
    winston.level = 'debug';
}

if (_program.verbose) {
    winston.level = 'silly';
}

if (_program.quiet) {
    winston.level = 'error';
}
create_server(_program.port, _program.file);
