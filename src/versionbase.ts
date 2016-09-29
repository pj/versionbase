import * as program from 'commander';
import {create_server} from './server';

let _program: any = program;

_program.option("-p, --port", "Port for proxy server", 9876).parse(process.argv);

create_server(_program.port);

export default program;
