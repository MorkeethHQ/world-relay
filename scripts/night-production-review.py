#!/usr/bin/env python3
"""Production code against local durable TEST DATA. No fixture verifier or real keys."""
import os,sys,pathlib
r=pathlib.Path(__file__).resolve().parent.parent;os.chdir(r)
for n in ['.env','.env.local','.env.production','.env.production.local']:
 if (r/n).exists():raise SystemExit('REFUSED: environment file present')
env={'PATH':os.environ['PATH'],'KV_REST_API_URL':'http://127.0.0.1:17180','KV_REST_API_TOKEN':'local-fake-not-a-secret','SESSION_SECRET':'local-test-data-not-a-secret','SESSION_ENFORCE':'true','NEXT_PUBLIC_FAVOUR_TEST_FIXTURE':'1','NEXT_TELEMETRY_DISABLED':'1'}
args=[str(r/'node_modules/.bin/next'),'start','--port',sys.argv[1] if len(sys.argv)>1 else '3196']
print('TEST DATA production code: persisted simulated people, actual Redis, real checker unavailable, no real payment',flush=True)
os.execve(args[0],args,env)
