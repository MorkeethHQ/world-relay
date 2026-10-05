import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const CONTAINER = "favour-sol-review-redis-20261005";
const encode = (x: unknown) => typeof x === "object" && x !== null ? JSON.stringify(x) : String(x);
export function realRedis() {
  let fault: ((cmd: string, key: string, args: unknown[]) => boolean) | null = null;
  async function command(cmd: string, ...args: unknown[]) {
    const { stdout } = await run("docker", ["exec", CONTAINER, "redis-cli", "--json", cmd.toUpperCase(), ...args.map(encode)]);
    const value = JSON.parse(stdout.trim());
    if (fault?.(cmd.toLowerCase(), String(args[0]), args)) { fault = null; throw new Error("TEST DATA: response lost after Redis applied the command"); }
    return value;
  }
  const client: Record<string, any> = {
    get: (key: string) => command("GET", key),
    set: (key: string, value: unknown, opt: any = {}) => command("SET", key, value, ...(opt.nx ? ["NX"] : []), ...(opt.ex ? ["EX", opt.ex] : []), ...(opt.px ? ["PX", opt.px] : [])),
    hset: (key: string, fields: Record<string, unknown>) => command("HSET", key, ...Object.entries(fields).flat()),
    hgetall: (key: string) => command("HGETALL", key),
    eval: (lua: string, keys: string[], args: unknown[]) => command("EVAL", lua, keys.length, ...keys, ...args),
    zadd: (key: string, v: { score: number; member: string }) => command("ZADD", key, v.score, v.member),
  };
  for (const cmd of ["sadd", "srem", "smembers", "scard", "sismember", "hincrby", "lpush", "lrange", "ltrim", "del", "expire", "incr", "zrange", "zrevrange", "zscore", "zrem", "sinter", "exists", "hget", "hdel"]) client[cmd] = (...args: unknown[]) => command(cmd, ...args);
  client.pipeline = () => {
    const commands: Array<[string, unknown[]]> = [];
    const pipe: Record<string, any> = {};
    for (const name of Object.keys(client).filter((k) => k !== "pipeline")) pipe[name] = (...args: unknown[]) => { commands.push([name, args]); return pipe; };
    pipe.exec = async () => { const results = []; for (const [name, args] of commands) results.push(await client[name](...args)); return results; };
    return pipe;
  };
  return { client, command, loseResponseAfter: (fn: (cmd: string, key: string, args: unknown[]) => boolean) => { fault = fn; } };
}
