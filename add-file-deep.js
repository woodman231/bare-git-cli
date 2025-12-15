import fs from 'fs';
import git from 'isomorphic-git';
import path from 'path';

// Parse arguments
const repoPath = process.argv[2];
const refName = process.argv[3];   // e.g., "main" or "refs/heads/dev"
const filePath = process.argv[4];  // e.g., "src/models/user.js"
const fileContent = process.argv[5];

if (!repoPath || !refName || !filePath || !fileContent) {
    console.error("Usage: node add-file-deep.js <repo> <ref> <path> <content>");
    process.exit(1);
}

const gitdir = path.resolve(repoPath);

// --- HELPER: Recursive Tree Upsert ---
// This function walks down the path parts.
// If it finds a tree, it reads it. If not, it starts a fresh list.
// It reconstructs the tree with the new child and returns the new Tree SHA.
async function upsertTree(dir, parentTreeSha, pathParts, fileBlobSha) {
    const [currentPart, ...remainingParts] = pathParts;

    // 1. Read existing entries (if this tree exists)
    let entries = [];
    if (parentTreeSha) {
        const result = await git.readTree({ fs, gitdir: dir, oid: parentTreeSha });
        entries = result.tree;
    }

    // 2. Remove the existing entry for the current part (we will replace it)
    //    (This handles "updating" a file or folder)
    entries = entries.filter(e => e.path !== currentPart);

    // 3. Determine what we are adding
    if (remainingParts.length === 0) {
        // BASE CASE: We are at the file level (The Leaf)
        entries.push({
            mode: '100644', // File mode
            path: currentPart,
            oid: fileBlobSha,
            type: 'blob'
        });
    } else {
        // RECURSIVE STEP: We are at a folder level
        // Find if there was an existing subtree here to reuse
        const existingEntry = (parentTreeSha)
            ? (await git.readTree({ fs, gitdir: dir, oid: parentTreeSha })).tree.find(e => e.path === currentPart)
            : null;

        const existingSubTreeSha = existingEntry ? existingEntry.oid : null;

        // Recurse down!
        const newSubTreeSha = await upsertTree(dir, existingSubTreeSha, remainingParts, fileBlobSha);

        entries.push({
            mode: '040000', // Directory mode
            path: currentPart,
            oid: newSubTreeSha,
            type: 'tree'
        });
    }

    // 4. Write the modified tree and return its SHA
    return await git.writeTree({
        fs,
        gitdir: dir,
        tree: entries
    });
}


async function main() {
    try {
        console.log(`Open Repo: ${gitdir}`);

        // --- STEP 1: Resolve Parent Commit ---
        let parentSha;
        try {
            parentSha = await git.resolveRef({ fs, gitdir, ref: refName });
            console.log(`Parent Commit (${refName}): ${parentSha.slice(0, 7)}`);
        } catch (e) {
            console.log(`Ref ${refName} not found. Creating root commit.`);
            parentSha = null; // Will result in a root commit (no parents)
        }

        // --- STEP 2: Get Root Tree ---
        let rootTreeSha = null;
        if (parentSha) {
            const commit = await git.readCommit({ fs, gitdir, oid: parentSha });
            rootTreeSha = commit.commit.tree;
        }

        // --- STEP 3: Create the Blob ---
        const blobSha = await git.writeBlob({
            fs,
            gitdir,
            blob: new Uint8Array(Buffer.from(fileContent)),
        });
        console.log(`Blob created: ${blobSha.slice(0, 7)}`);

        // --- STEP 4: Recursive Tree Surgery ---
        // Remove leading slashes and split path
        const pathParts = filePath.replace(/^\/+/, '').split('/');

        // Start the recursion from the root
        const newRootTreeSha = await upsertTree(gitdir, rootTreeSha, pathParts, blobSha);
        console.log(`New Root Tree: ${newRootTreeSha.slice(0, 7)}`);

        // --- STEP 5: Create Commit ---
        const author = {
            name: 'API Bot',
            email: 'bot@example.com',
            timestamp: Math.floor(Date.now() / 1000),
            timezoneOffset: 0
        };

        const commitSha = await git.writeCommit({
            fs,
            gitdir,
            commit: {
                message: `Add ${filePath}`,
                tree: newRootTreeSha,
                parent: parentSha ? [parentSha] : [],
                author: author,
                committer: author
            }
        });

        // --- STEP 6: Update Ref (Manual Compare-and-Swap) ---

        // 1. Re-check the current state of the branch right now
        //    (This handles the "Optimistic Locking" manually)
        let currentSha;
        try {
            currentSha = await git.resolveRef({ fs, gitdir, ref: refName });
        } catch (e) {
            currentSha = null; // Ref doesn't exist yet
        }

        // 2. Compare: Has the branch moved since we started?
        //    If currentSha != parentSha, someone else pushed code while we were working.
        if (currentSha !== parentSha) {
            throw new Error(`Concurrency Error: The ref '${refName}' has changed from ${parentSha} to ${currentSha}. Aborting.`);
        }

        // 3. Swap: Since we verified the match, we can safely Force the update.
        await git.writeRef({
            fs,
            gitdir,
            ref: `refs/heads/${refName.replace('refs/heads/', '')}`,
            value: commitSha,
            force: true // Safe because we manually checked above!
        });

        console.log(`Success! Updated ${refName} to ${commitSha.slice(0, 7)}`);

    } catch (err) {
        console.error("Error:", err);
    }
}

main();