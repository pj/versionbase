/// <reference path="../typings/index.d.ts" />
/// <reference path="../typings/auto.d.ts" />
/// <reference path="./manual.d.ts" />
import {Set, Map, Record, Seq} from 'immutable';
var jexl = require('Jexl');
var exprjs = require('exprjs');

var parser = new exprjs();

var uuid = require('uuid');

var pi = require('pretty-immutable');

export let Version = Record({parents: null, version_id: null, items: Map()}, 'Version');

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
        return [snapshots, snapshots.getIn([transaction_id, version_id, "items", item_id])];
    } else {
        return [snapshots, null];
    }
}

export function update_item(snapshots, item_id, version_id, transaction_id, data) {
    check_transaction_and_version(snapshots, transaction_id, version_id);
    data.id = item_id;
    data.version = version_id;

    return [snapshots.setIn([transaction_id, version_id, "items", item_id], data), null];
}

export function delete_item(snapshots, item_id, version_id, transaction_id) {
    check_transaction_and_version(snapshots, transaction_id, version_id);
    if (snapshots.hasIn([transaction_id, version_id, "items", item_id])) {
        return [snapshots.deleteIn([transaction_id, version_id, "items", item_id]), null];
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

export function find_items(snapshots, version_id, transaction_id,
                           selection_expression, filter_expression) {
    check_transaction_and_version(snapshots, transaction_id, version_id);
    let items = snapshots.getIn([transaction_id, version_id, "items"]);
    let filter_parsed = filter_expression !== null ? parser.parse(filter_expression) : parser.parse("true");
    let select_parsed = selection_expression !== null ? parser.parse(selection_expression) : null;
    let results = []
    for (let item of items.values()) {
        if (parser.run(filter_parsed, item)) {
            if (select_parsed !== null) {
                results.push(parser.run(select_parsed, item));
            } else {
                results.push(item);
            }
        }
    }

    return [snapshots, results];
}

export function create_version(snapshots, commit_id, data_parent_id, parents) {
    let new_version;
    // handle initial commit.
    if (parents === null || parents === undefined ||
        (Array.isArray(parents) && parents.length === 0)) {
        // FIXME: git can apparently have multiple independent intial commits,
        // not sure if this should be allowed?
        new_version = new Version({parents: Seq(), version_id: commit_id});
    } else if(parents.length === 1) {
        // TODO: Not sure if new commits should always get data from parent
        // commits or be able to get data from further back.
        let parent_version = snapshots.getIn(["current", parents[0]]);
        if (parent_version === undefined) {
            throw new Error("Parent commit does not exist");
        }
        new_version = new Version({parents: Seq.of(parent_version),
                                       version_id: commit_id,
                                       items: parent_version.items});
    } else{
        let parent_versions = [];
        for (let parent_id in parents) {
            let parent_version = snapshots.getIn(["current", parent_id]);
            if (parent_version === undefined) {
                throw new Error("Parent commit does not exist");
            }
            parent_versions.push(parent_version);
        }
        if(data_parent_id === null) {
            // TODO: Multiple parents, but no provided data_parent_id. Not yet
            // sure how to merge this, so choose first parent :-)
            data_parent_id = parents[0];
        } else if (!parents.includes(data_parent_id)){
            // check that data_parent_id is actually one of the parent ids
            throw new Error("Data parent id not one of the parent ids!");
        }

        let data_parent_version = snapshots.getIn(["current", data_parent_id]);

        new_version = new Version({parents: Seq.of(parent_versions),
                                       version_id: commit_id,
                                       items: data_parent_version.items});
    }
    return [snapshots.setIn(["current", commit_id], new_version), null];
}

export function version_exists(snapshots, commit_id) {
    return [snapshots, snapshots.hasIn(["current", commit_id])];
}

// Set a version to use the items of another version.
export function set_all_version_items(snapshots, source_snapshot, dest_snapshot,
                                 source_commit_id, dest_commit_id) {
     let source_version = snapshots.getIn([source_snapshot, source_commit_id]);
     let dest_version = snapshots.getIn([dest_snapshot, dest_commit_id]);

     let new_version = dest_version.set("items", source_version.items);

     return [snapshots.setIn([dest_snapshot, dest_commit_id], new_version), null];
}

// copy items from one version to another.
export function copy_version_items(snapshots, source_snapshot, dest_snapshot,
                                   source_commit_id, dest_commit_id, source_ids,
                                   replace) {
     let source_items = snapshots.getIn([source_snapshot, source_commit_id, "items"]);
     let dest_version = snapshots.getIn([dest_snapshot, dest_commit_id]);
     let dest_items = dest_version.items;

     for (let source_id in source_ids) {
         let source_item = source_items.get(source_id);
         if (dest_items.has(source_id)) {
             if (replace) {
                 dest_items = dest_items.set(source_id, source_item);
             } else {
                 throw new Error(`Item ${source_id} already exists in destination version.`);
             }
         } else {
             dest_items = dest_items.set(source_id, source_item);
         }
     }
     let new_version = dest_version.set("items", dest_items);

     return [snapshots.setIn([dest_snapshot, dest_commit_id], new_version), null];
}

export function begin_transaction(snapshots, snapshot_id) {
    let transaction_id = uuid.v4();
    let snapshot = snapshots.get(snapshot_id);
    let new_snapshots = snapshots.set(transaction_id, snapshot);
    new_snapshots = new_snapshots.set("original-" + transaction_id, snapshot);
    return [new_snapshots, transaction_id];
}

function merge_version(original_version, current_version, completed_version) {
    let current_keys = Set.fromKeys(current_version.items);
    let completed_keys = Set.fromKeys(completed_version.items);

    let new_version = new Version({parents: current_version.parents,
                                   version_id: current_version.version_id});
    let keys: any = current_keys.concat(completed_keys);
    for (let key of keys) {
        let current_item = current_version.items.get(key);
        let completed_item = completed_version.items.get(key);
        let original_item = original_version.items.get(key);

        if (current_item) {
            if (completed_item) {
                if (current_item === completed_item) {
                    // both exist and are the same.
                    new_version = new_version.setIn(["items", key], current_item);
                } else {
                    if (original_item) {
                        // both are different from original - bailout
                        if (current_item !== original_item && completed_item !== original_item) {
                            throw new Error(`Concurrency error: both modified ${key}`);
                        } else if (current_item !== original_item) {
                            // completed is unchanged but current has been modified.
                            new_version = new_version.setIn(["items", key], current_item);
                        } else {
                            // current is unchanged, completed has changed.
                            new_version = new_version.setIn(["items", key], completed_item);
                        }
                    } else {
                        // weird scenario where both current and completed both
                        // created an item of the same id. bailout.
                        throw new Error(`Concurrency error: two items with the same key ${key} created (this shouldn't happen)`);
                    }
                }
            } else {
                if (original_item !== undefined) {
                    if (current_item !== original_item) {
                        throw new Error(`Concurrency error: key ${key} was updated and deleted.`)
                    } else {
                        // if current was the same as original then completed was
                        // deleted i.e. continue.
                    }
                } else {
                    // new item
                    new_version = new_version.setIn(["items", key], current_item);
                }
            }
        } else {
            if (completed_item) {
                if (original_item !== undefined) {
                    // current was deleted and completed updated - bailout.
                    if (completed_item !== original_item) {
                        throw new Error(`Concurrency error: key ${key} was updated and deleted.`)
                    }
                } else {
                    // new item
                    new_version = new_version.setIn(["items", key], completed_item);
                }
            } else {
                throw new Error(`Concurrency error: key ${key} but no items (this shouldn't be possible)`);
            }
        }
    }

    return new_version;
}

function merge_transshots(original, current, completed) {
    let new_transshots = Map();

    for (let [commit_id, current_version] of current.entries()) {
        let completed_version = completed.get(commit_id);
        let new_version;

        // if the version exists - right now can only add new versions to current
        // so completed should never have a version that isn't in current.
        if (completed_version) {
            // if the version hasn't changed.
            if (current_version === completed_version) {
                new_version = current_version;
            // one or other has changed.
            } else {
                let original_version = original.get(commit_id);

                // both are different, merge.
                if (completed_version !== original_version &&
                    current_version !== original_version) {
                    new_version = merge_version(original_version,
                                                current_version,
                                                completed_version);
                // completed_version has changed.
                } else if (completed_version !== original_version) {
                    new_version = completed_version;
                } else {
                    // current has changed.
                    new_version = current_version;
                }
            }
        } else {
            new_version = current_version;
        }
        new_transshots = new_transshots.set(commit_id, new_version);
    }

    return new_transshots;
}

export function commit_transaction(snapshots, transaction_id) {
    let new_current;
    let completed_transaction = snapshots.get(transaction_id);
    let current_snapshot = snapshots.get("current");
    let original_snapshot = snapshots.get("original-" + transaction_id);
    if (original_snapshot === current_snapshot) {
        new_current = completed_transaction;
    } else {
        new_current = merge_transshots(original_snapshot, current_snapshot,
                                       completed_transaction);
    }

    snapshots = snapshots.set("current", new_current);
    snapshots = snapshots.delete("original-" + transaction_id);
    return [snapshots.delete(transaction_id), null];
}

export function rollback_transaction(snapshots, transaction_id) {
    snapshots = snapshots.delete("original-" + transaction_id);
    return [snapshots.delete(transaction_id), null];
}

export function create_snapshot(snapshots, existing_snapshot_id) {
    let snapshot_id = uuid.v4();

    let current_snapshot = snapshots.get(existing_snapshot_id);
    let new_snapshots = snapshots.set(snapshot_id, current_snapshot);

    return [new_snapshots, snapshot_id];
}

export function delete_snapshot(snapshots, snapshot_id: string) {
    return [snapshots.delete(snapshot_id), null];
}
