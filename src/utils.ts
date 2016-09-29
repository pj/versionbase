/// <reference path="../typings/index.d.ts" />
/// <reference path="../typings/auto.d.ts" />
/// <reference path="manual.d.ts" />
import * as q from 'q';
import * as child_process from 'child_process';
import * as fse from 'fs-extra';

export function exec(command: string, options=null){
    var deferred = q.defer();
    if (options) {
        var proc = child_process.exec(command, options);
    } else {
        var proc = child_process.exec(command);
    }

    var stdout_data = [];
    var stderr_data = [];

    proc.stdout.on('data', (data) => {
        //console.log("-------");
        //console.log(command);
        //console.log(data);
        stdout_data.push(data);
        deferred.notify([data, null]);
    });

    proc.stderr.on('data', (data) => {
        //console.log("-------");
        //console.log(command);
        //console.log(data);
        stderr_data.push(data);
        deferred.notify([null, data]);
    });

    proc.on('error', function(err) {
        deferred.reject(err);
    });

    proc.on('close', (code) => {
        let stdout = stdout_data.join("");
        let stderr = stderr_data.join("");
        //console.log("=======");
        //console.log(command);
        //console.log(stdout);
        //console.log("-------");
        //console.log(stderr);

        if (code !== 0) {
            deferred.reject(new Error("Process closed unexpectedly with code: " + code));
        } else {
            deferred.resolve([stdout, stderr]);
        }
    });

    return deferred.promise;
}
