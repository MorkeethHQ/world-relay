#!/usr/bin/env python3
"""Loopback-only Upstash REST transport to ACTUAL local Redis. Lua is executed by Redis.
The optional fixture sign-in is visibly TEST DATA, never World ID or wallet proof.
No cloud credentials, model calls or chain calls are used here.
"""
import argparse,base64,hashlib,hmac,json,socket,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlparse,parse_qs
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--redis-port',type=int,default=17179);p.add_argument('--port',type=int,default=17180);p.add_argument('--fixture',required=True);a=p.parse_args();fx=json.loads(Path(a.fixture).read_text())
def send(f,cmd):
 parts=[str(v) if not isinstance(v,(dict,list)) else json.dumps(v,separators=(',',':')) for v in cmd]
 f.write(('*'+str(len(parts))+'\r\n').encode())
 for v in parts:
  b=v.encode();f.write(('$'+str(len(b))+'\r\n').encode()+b+b'\r\n')
 f.flush()
def read(f):
 t=f.read(1);v=f.readline()[:-2]
 if t==b'+':return v.decode()
 if t==b'-':raise ValueError(v.decode())
 if t==b':':return int(v)
 if t==b'$':
  n=int(v)
  if n<0:return None
  b=f.read(n);f.read(2);return b.decode()
 if t==b'*':
  n=int(v);return None if n<0 else [read(f) for _ in range(n)]
 raise ValueError('Invalid Redis response')
def execute(commands,transaction=False):
 with socket.create_connection(('127.0.0.1',a.redis_port),timeout=5) as sock:
  f=sock.makefile('rwb')
  if transaction:send(f,['MULTI']);read(f)
  values=[]
  for cmd in commands:send(f,cmd);values.append(read(f))
  if transaction:send(f,['EXEC']);values=read(f)
  return values
def b64(v):
 if isinstance(v,str):return base64.b64encode(v.encode()).decode()
 if isinstance(v,list):return [b64(x) for x in v]
 return v
class Handler(BaseHTTPRequestHandler):
 def reply(self,status,value):
  self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(json.dumps(value).encode())
 def do_GET(self):
  u=urlparse(self.path)
  if u.path=='/__log':
   try:execute([['PING']]);return self.reply(200,{'fake':False,'fixture':True,'durable':True,'engine':'Redis','aof':True,'fsync':'always','redisPort':a.redis_port})
   except Exception:return self.reply(503,{'error':'Isolated Redis unavailable'})
  if u.path=='/__fixture/signin':
   key=parse_qs(u.query).get('as',[''])[0];actor=next((v for v in fx['participants'] if v['key']==key),None)
   if not actor:return self.reply(400,{'error':'Unknown TEST DATA actor'})
   payload=base64.urlsafe_b64encode(f"{actor['address'].lower()}.{int(time.time()*1000)+86400000}".encode()).decode().rstrip('=');sig=base64.urlsafe_b64encode(hmac.new(fx['sessionSecret'].encode(),payload.encode(),hashlib.sha256).digest()).decode().rstrip('=')
   # Session protocol signs decoded payload, not its base64 representation.
   decoded=base64.urlsafe_b64decode(payload+'='*((4-len(payload)%4)%4));sig=base64.urlsafe_b64encode(hmac.new(fx['sessionSecret'].encode(),decoded,hashlib.sha256).digest()).decode().rstrip('=')
   self.send_response(302);self.send_header('Set-Cookie',f'favour_session={payload}.{sig}; HttpOnly; SameSite=Lax; Path=/');self.send_header('Location','/');self.end_headers();return
  if u.path=='/__fixture':
   self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(('<h1>TEST DATA only</h1><p>Simulated sessions. No person verified, no wallet signed, no money moved. Data persists in isolated local Redis.</p>'+''.join(f'<p><a href="/__fixture/signin?as={v["key"]}">{v["name"]}</a> · {v["role"]}</p>' for v in fx['participants'])).encode());return
  self.reply(404,{'error':'Not found'})
 def do_POST(self):
  if self.headers.get('authorization')!='Bearer local-fake-not-a-secret':return self.reply(401,{'error':'Isolated review token required'})
  try:
   data=json.loads(self.rfile.read(int(self.headers.get('content-length','0'))));batch=self.path in ['/pipeline','/multi-exec'];results=execute(data if batch else [data],self.path=='/multi-exec');enc=b64 if self.headers.get('upstash-encoding')=='base64' else lambda x:x
   return self.reply(200,[{'result':enc(v)} for v in results] if batch else {'result':enc(results[0])})
  except Exception as e:return self.reply(400,{'error':str(e)})
 def log_message(self,*args):pass
print(f'TEST DATA real Redis REST transport on 127.0.0.1:{a.port}, Redis:{a.redis_port}, AOF storage',flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
