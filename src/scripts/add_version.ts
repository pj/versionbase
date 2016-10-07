import {Connection} from '../client';

async function add_version() {
    let connection = await Connection.connect();
    if (process.argv.length === 3) {
        await connection.create_version(process.argv[2]);
    } else if (process.argv.length === 4) {
        await connection.create_version(process.argv[2], [process.argv[3]]);
    } else {
        throw new Error("Git hash and commit id required");
    }
    await connection.disconnect();
}

add_version()
    .then(_ => console.log("added version " + process.argv[2] + " to versionbase."))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
