#!/usr/bin/env python3
"""Run the fixture with a clean environment: no real credentials or funds path."""
import os,sys,pathlib
r=pathlib.Path(__file__).resolve().parent.parent;os.chdir(r)
for n in ['.env','.env.local','.env.development','.env.development.local']:
 if (r/n).exists():raise SystemExit('REFUSED: real environment file present in fixture checkout')
env={'PATH':os.environ['PATH'],'KV_REST_API_URL':'http://127.0.0.1:17180','KV_REST_API_TOKEN':'local-fake-not-a-secret','SESSION_SECRET':'local-test-data-not-a-secret','ADMIN_SECRET':'local-test-data-admin-not-a-secret','FAVOUR_TEST_FIXTURE':'1','NEXT_PUBLIC_FAVOUR_TEST_FIXTURE':'1','SESSION_ENFORCE':'true','NEXT_TELEMETRY_DISABLED':'1','WATCHPACK_POLLING':'1000'}
args=[str(r/'node_modules/.bin/next'),'dev','--turbopack','--port',sys.argv[1] if len(sys.argv)>1 else '3195']
print('TEST DATA local fixture: simulated sessions/verifier, actual local Redis AOF, no inherited service credentials',flush=True)
os.execve(args[0],args,env)
