import * as program from 'commander';
import {create_server} from './server';
import * as winston from "winston";

let _program: any = program;

_program.option("-p, --port", "Port for proxy server", 9876);
_program.option("-d, --debug", "Set debug logging", false);
_program.option("-v, --verbose", "Set verbose logging", false);
_program.option("-q, --quiet", "Suppress output", false);

_program.parse(process.argv);
if (_program.debug) {
    winston.level = 'debug';
}

if (_program.verbose) {
    winston.level = 'silly';
}

if (_program.quiet) {
    winston.level = 'error';
}

create_server(_program.port);

export default program;
