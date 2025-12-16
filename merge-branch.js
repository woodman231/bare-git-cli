import fs from 'fs';
import git from 'isomorphic-git';
import path from 'path';

const repoPath = process.argv[2];
const sourceBranch = process.argv[3];
const destBranch = process.argv[4];
// Optional: JSON string of merge conflict resolutions (e.g., '{"test1.txt": "resolved content"}')
const resolutionsRaw = process.argv[5];

if (!repoPath || !sourceBranch || !destBranch) {
    console.error("Usage: node merge-branch.js <repo> <source> <dest> [json-resolutions]");
    process.exit(1);
}

const gitdir = path.resolve(repoPath);
console.log(`Open Repo: ${gitdir}`);
console.log("Resolutions Raw:", resolutionsRaw);
const resolutions = resolutionsRaw ? JSON.parse(resolutionsRaw) : {};

// Performs a 3-way tree merge with optional conflict resolution
async function mergeTrees(baseTreeSha, ourTreeSha, theirTreeSha) {

    const readEntries = async (sha) => {
        if (!sha) return new Map();
        const res = await git.readTree({ fs, gitdir, oid: sha });
        return new Map(res.tree.map(e => [e.path, e]));
    };

    const baseEntries = await readEntries(baseTreeSha);
    const ourEntries = await readEntries(ourTreeSha);
    const theirEntries = await readEntries(theirTreeSha);

    const allPaths = new Set([
        ...baseEntries.keys(), ...ourEntries.keys(), ...theirEntries.keys()
    ]);

    const newEntries = [];

    for (const p of allPaths) {
        const base = baseEntries.get(p);
        const ours = ourEntries.get(p);
        const theirs = theirEntries.get(p);

        const baseSha = base ? base.oid : null;
        const ourSha = ours ? ours.oid : null;
        const theirSha = theirs ? theirs.oid : null;

        // Handle directories recursively
        const isDir = (ours && ours.type === 'tree') || (theirs && theirs.type === 'tree');
        if (isDir) {
            const mergedSubTreeSha = await mergeTrees(baseSha, ourSha, theirSha);
            if (mergedSubTreeSha) {
                newEntries.push({ mode: '040000', path: p, oid: mergedSubTreeSha, type: 'tree' });
            }
            continue;
        }

        // Merge file blobs
        if (ourSha === theirSha) {
            if (ours) newEntries.push(ours);
        }
        else if (ourSha === baseSha && theirSha !== baseSha) {
            if (theirs) newEntries.push(theirs);
        }
        else if (ourSha !== baseSha && theirSha === baseSha) {
            if (ours) newEntries.push(ours);
        }
        else {
            // Conflict detected - check for user-provided resolution
            console.log(`Conflict detected at: ${p}`);

            if (resolutions[p]) {
                console.log(` -> Resolution provided for '${p}'. Applying...`);

                const resolvedSha = await git.writeBlob({
                    fs,
                    gitdir,
                    blob: new Uint8Array(Buffer.from(resolutions[p]))
                });

                newEntries.push({
                    mode: '100644',
                    path: p,
                    oid: resolvedSha,
                    type: 'blob'
                });
            } else {
                throw new Error(`Merge Conflict at file '${p}'. No resolution provided.`);
            }
        }
    }

    if (newEntries.length === 0) return null;
    return await git.writeTree({ fs, gitdir, tree: newEntries });
}

async function main() {
    try {
        // Resolve branch references
        const sourceRef = sourceBranch.startsWith('refs/') ? sourceBranch : `refs/heads/${sourceBranch}`;
        const destRef = destBranch.startsWith('refs/') ? destBranch : `refs/heads/${destBranch}`;
        const sourceSha = await git.resolveRef({ fs, gitdir, ref: sourceRef });
        const destSha = await git.resolveRef({ fs, gitdir, ref: destRef });

        // Find merge base
        const mergeBases = await git.findMergeBase({ fs, gitdir, oids: [destSha, sourceSha] });
        const baseSha = mergeBases[0];

        // Read commit trees
        const baseCommit = await git.readCommit({ fs, gitdir, oid: baseSha });
        const sourceCommit = await git.readCommit({ fs, gitdir, oid: sourceSha });
        const destCommit = await git.readCommit({ fs, gitdir, oid: destSha });

        // Perform 3-way merge
        const newTreeSha = await mergeTrees(
            baseCommit.commit.tree,
            destCommit.commit.tree,
            sourceCommit.commit.tree
        );

        // Create merge commit and update reference
        const author = { name: 'Merge Bot', email: 'bot@example.com', timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 };
        const mergeCommitSha = await git.writeCommit({
            fs, gitdir,
            commit: {
                message: `Merge branch '${sourceBranch}' into '${destBranch}'`,
                tree: newTreeSha,
                parent: [destSha, sourceSha],
                author: author, committer: author
            }
        });

        await git.writeRef({ fs, gitdir, ref: destRef, value: mergeCommitSha, force: true });
        console.log(`Success! New Commit: ${mergeCommitSha.slice(0, 7)}`);

    } catch (err) {
        console.error("Merge Failed:", err.message);
        process.exit(1);
    }
}

main();