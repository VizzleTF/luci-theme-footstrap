/* The environment for real git in a scratch repo. A caller's GIT_INDEX_FILE (a round snapshot), GIT_DIR
 * or GIT_WORK_TREE (a hook) would point the scratch repo's git at the caller's repo and write its index.
 * Every GIT_* name goes, not just `git rev-parse --local-env-vars`: GIT_CONFIG_*, author/committer and
 * ssh overrides would leak the caller's identity into a scratch commit. */
export const cleanEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([ k ]) => !k.startsWith('GIT_')));
export const CLEAN = cleanEnv();
