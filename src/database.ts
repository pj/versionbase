/// <reference path="../typings/index.d.ts" />
/// <reference path="../typings/auto.d.ts" />
/// <reference path="./manual.d.ts" />
import {Map, Record} from 'immutable';
var uuid = require('uuid');

let Version = Record({parent: null, version_id: null, items: Map()});

function check_transaction_and_version(snapshots, transaction_id, version_id) {
    if (snapshots.has(transaction_id)) {
        if (snapshots.hasIn([transaction_id, version_id])) {
            return null;
        } else {
            throw new Error("Invalid version");
        }
    } else {
        throw new Error("Invalid transaction");
    }
}

export function get_item(snapshots, item_id, version_id, transaction_id) {
    check_transaction_and_version(snapshots, transaction_id, version_id);
    if (snapshots.hasIn([transaction_id, version_id, "items", item_id])) {
        return snapshots.getIn([transaction_id, version_id, "items", item_id]);
    } else {
        return null;
    }
}

export function update_item(snapshots, item_id, version_id, transaction_id, data) {
    check_transaction_and_version(snapshots, transaction_id, version_id);
    data.id = item_id;
    data.version = version_id;

    return snapshots.setIn([transaction_id, version_id, "items", item_id], data);
}

export function delete_item(snapshots, item_id, version_id, transaction_id) {
    check_transaction_and_version(snapshots, transaction_id, version_id);
    if (snapshots.hasIn([transaction_id, version_id, "items", item_id])) {
        return snapshots.deleteIn([transaction_id, version_id, "items", item_id])
    } else {
        throw new Error("Item does not exist");
    }
}

export function create_item(snapshots, version_id, transaction_id, data) {
    check_transaction_and_version(snapshots, transaction_id, version_id);
    let item_id = uuid.v4();
    data.id = item_id;
    data.version = version_id;
    let new_snapshots = snapshots.setIn([transaction_id, version_id, "items", item_id], data);
    return [new_snapshots, item_id];
}

export function find_items(snapshots, project, select, reduce, version_id, transaction_id) {
    let snapshot = snapshots.get(transaction_id);
    let git_version = snapshot.get(version_id);
    let results = git_version.items.filter(select).reduce(reduce).map(project);

    return [snapshots, results];
}

export function create_version(snapshots, commit_id, parent_commit_id): Map<string, Map<string, any>> {
    // handle initial commit.
    if (parent_commit_id === null || parent_commit_id === undefined) {
        // FIXME: git can apparently have multiple independent intial commits,
        // not sure if this should be allowed?
        var new_version = new Version({parent: null, version_id: commit_id});
    } else {
        //let current_snapshot = snapshots.get("current", Map());
        //let parent_version = current_snapshot.get(parent_commit_id);
        let parent_version = snapshots.getIn(["current", parent_commit_id]);
        if (parent_version === undefined) {
            throw new Error("parent commit does not exist");
        }
        var new_version = new Version({parent: parent_version,
                                       version_id: commit_id,
                                       items: parent_version.items});
    }
    //console.log(snapshots);
    return snapshots.setIn(["current", commit_id], new_version);
}

export function version_exists(snapshots, commit_id) {
    return [snapshots, snapshots.hasIn(["current", commit_id])];
}

export function begin_transaction(snapshots, snapshot_id) {
    let transaction_id = uuid.v4();
    let snapshot = snapshots.get(snapshot_id);
    let new_snapshots = snapshots.set(transaction_id, snapshot);
    new_snapshots = new_snapshots.set("original-" + transaction_id, snapshot);
    return [new_snapshots, transaction_id];
}

export function commit_transaction(snapshots, transaction_id) {
    let completed_transaction = snapshots.get(transaction_id);
    let current_snapshot = snapshots.get("current");
    let original_snapshot = snapshots.get("original-" + transaction_id);
    let new_snapshot = snapshots.get(transaction_id);
    // reject concurrent updates to database - for now.
    if (current_snapshot === original_snapshot) {
        let new_current = snapshots.set("current", new_snapshot);
        new_current = new_current.delete("original-" + transaction_id);
        return new_current.delete(transaction_id);
    } else {
        // TODO: rollback here? or should transaction state be saved for examination?
        throw new Error("Concurrent updates not allowed!");
    }
}

export function rollback_transaction(snapshots, transaction_id) {
    let new_snapshots = snapshots.delete("original-" + transaction_id);
    return new_snapshots.delete(transaction_id);
}

export function create_snapshot(snapshots, existing_snapshot_id) {
    let snapshot_id = uuid.v4();

    let current_snapshot = snapshots.get(existing_snapshot_id);
    let new_snapshots = snapshots.set(snapshot_id, current_snapshot);

    return [new_snapshots, snapshot_id];
}

export function delete_snapshot(snapshots, snapshot_id: string) {
    return snapshots.delete(snapshot_id);
}
