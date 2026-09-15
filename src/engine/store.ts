import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type {FileEntry,Job,Snapshot} from '../shared/contracts';

export class Store {
 readonly db:DatabaseSync;
 constructor(directory:string){
  mkdirSync(directory,{recursive:true});this.db=new DatabaseSync(join(directory,'sentry.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
  CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,created TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS jobs_created ON jobs(created DESC);
  CREATE TABLE IF NOT EXISTS snapshots(destination TEXT NOT NULL,id TEXT NOT NULL,time TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(destination,id));
  CREATE INDEX IF NOT EXISTS snapshots_time ON snapshots(destination,time DESC);
  CREATE TABLE IF NOT EXISTS files(destination TEXT NOT NULL,snapshot TEXT NOT NULL,path TEXT NOT NULL,type TEXT NOT NULL,size INTEGER NOT NULL,mtime TEXT,PRIMARY KEY(destination,snapshot,path));
  CREATE TABLE IF NOT EXISTS indexed(destination TEXT NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(destination,snapshot));`);
  for(const job of this.jobs(0,10000).jobs)if(job.status==='running'){job.status='interrupted';job.finishedAt=new Date().toISOString();job.error='Sentry stopped during this operation. Check the destination and retry; only committed snapshots are recoverable.';this.job(job);}
 }
 get<T>(kind:string,id:string):T|undefined{const row=this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(String(row.data)) as T:undefined;}
 all<T>(kind:string):T[]{return this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row=>JSON.parse(String(row.data)) as T);}
 put(kind:string,id:string,data:unknown){this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,id,JSON.stringify(data));}
 remove(kind:string,id:string){this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);}
 job(job:Job){this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data').run(job.id,job.createdAt,job.status,JSON.stringify(job));}
 getJob(id:string):Job{const row=this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id);if(!row)throw new Error('This operation is no longer in history.');return JSON.parse(String(row.data)) as Job;}
 jobs(offset=0,limit=100):{jobs:Job[];total:number}{return {jobs:this.db.prepare('SELECT data FROM jobs ORDER BY created DESC LIMIT ? OFFSET ?').all(limit,offset).map(row=>JSON.parse(String(row.data)) as Job),total:Number(this.db.prepare('SELECT COUNT(*) AS n FROM jobs').get()!.n)};}
 queued():Job[]{return this.db.prepare("SELECT data FROM jobs WHERE status='queued' ORDER BY created").all().map(r=>JSON.parse(String(r.data)) as Job);}
 setSnapshots(destination:string,snapshots:Snapshot[]){this.db.exec('BEGIN');try{this.db.prepare('DELETE FROM snapshots WHERE destination=?').run(destination);const stmt=this.db.prepare('INSERT INTO snapshots VALUES(?,?,?,?)');for(const s of snapshots)stmt.run(destination,s.id,s.time,JSON.stringify(s));this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 snapshots(destination:string){return this.db.prepare('SELECT data FROM snapshots WHERE destination=? ORDER BY time DESC').all(destination).map(r=>JSON.parse(String(r.data)) as Snapshot);}
 hasIndex(destination:string,snapshot:string){return !!this.db.prepare('SELECT 1 FROM indexed WHERE destination=? AND snapshot=?').get(destination,snapshot);}
 resetIndex(destination:string,snapshot:string){this.db.prepare('DELETE FROM files WHERE destination=? AND snapshot=?').run(destination,snapshot);this.db.prepare('DELETE FROM indexed WHERE destination=? AND snapshot=?').run(destination,snapshot);}
 addFiles(destination:string,snapshot:string,files:FileEntry[]){this.db.exec('BEGIN');try{const stmt=this.db.prepare('INSERT OR REPLACE INTO files VALUES(?,?,?,?,?,?)');for(const f of files)stmt.run(destination,snapshot,f.path,f.type,f.size,f.mtime??null);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 finishIndex(destination:string,snapshot:string){this.db.prepare('INSERT OR IGNORE INTO indexed VALUES(?,?)').run(destination,snapshot);}
 files(destination:string,snapshot:string,search:string,offset:number,limit:number){const query='%'+search.replace(/[\\%_]/g,'\\$&')+'%';const args=[destination,snapshot,query];return {entries:this.db.prepare("SELECT path,type,size,mtime FROM files WHERE destination=? AND snapshot=? AND path LIKE ? ESCAPE '\' ORDER BY path LIMIT ? OFFSET ?").all(...args,limit,offset) as unknown as FileEntry[],total:Number(this.db.prepare("SELECT COUNT(*) AS n FROM files WHERE destination=? AND snapshot=? AND path LIKE ? ESCAPE '\'").get(...args)!.n)};}
 close(){this.db.close();}
}
