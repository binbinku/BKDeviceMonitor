import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDeviceFiles, devicePath, listingCommand, parseListing, portableName } from '../desktop/device-files.mjs';

const tree = {
  '/sdcard': { type: 'directory' },
  '/sdcard/Download': { type: 'directory' },
  '/sdcard/Download/中文 space.txt': { type: 'file', text: 'hello 中文' },
  '/sdcard/Download/folder': { type: 'directory' },
  '/sdcard/Download/folder/a.txt': { type: 'file', text: 'alpha' },
  '/sdcard/Download/folder/.hidden': { type: 'file', text: '' },
  '/sdcard/Download/folder/skip-link': { type: 'symlink' },
  '/sdcard/Download/folder/CON.txt': { type: 'file', text: 'portable' },
  '/sdcard/Download/empty': { type: 'directory' }
};
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bkdm-files-')), destination = join(root, 'saved');
  await mkdir(destination);
  const configPath = join(root, 'config.json'), log = join(root, 'calls.jsonl'), adb = join(root, 'adb.mjs');
  const config = { tree: structuredClone(tree), ...options };
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(adb, `#!${process.execPath}
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2), config=JSON.parse(readFileSync(${JSON.stringify(configPath)},'utf8'));
appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
const quote=s=>"'"+s.replaceAll("'", "'\\\\''")+"'";
const entries=Object.entries(config.tree);
const stats=(path,entry)=>[(entry.type==='directory'?'41ed':entry.type==='file'?'81a4':'a1ff'),Buffer.byteLength(entry.text||''),1700000000].join(' ');
if(args[2]==='shell') {
 const command=args[3], pair=entries.find(([path])=>command.startsWith('p='+quote(path)+';'));
 if(!pair){console.error('No such file or directory');process.exit(1);}
 const [path,entry]=pair;
 if(entry.denied){console.error('Permission denied');process.exit(1);}
 if(command.includes('BKFM1')){
  let out='BKFM1\\x00';
  for(const [child,item] of entries) if(child.startsWith(path+'/') && !child.slice(path.length+1).includes('/')) out+=child.slice(path.length+1)+'\\x00'+stats(child,item)+'\\n\\x00';
  process.stdout.write(out);
 } else process.stdout.write(stats(path,entry)+'\\n');
} else if(args[2]==='pull') {
 const entry=config.tree[args[3]], target=args[4], data=Buffer.from(entry.text||'');
 if(config.slow) {
  writeFileSync(target,data.subarray(0,1));
  setTimeout(()=>{writeFileSync(target,data);console.log('1 file pulled');},5000);
 } else if(config.pullFailure) {writeFileSync(target,'partial'); console.error('adb: device offline');process.exit(1);}
 else {writeFileSync(target,config.wrongSize?'wrong bytes':data);console.log('1 file pulled');}
}
`);
  await chmod(adb, 0o700);
  const devices = [{ serial: 'phone-1', model: 'Test Phone', state: 'device' }, { serial: 'other-phone', state: 'device' }], events = [];
  const service = createDeviceFiles({ adbPath: adb, getDevices: async () => devices, onChange: event => events.push(event) });
  t.after(async () => { await service.stop(); await rm(root, { recursive: true, force: true }); });
  return { root, destination, configPath, config, log, service, devices, events };
}
async function download(f, paths) {
  const state = f.service.download({ serial: 'phone-1', destination: f.destination, paths });
  const id = state.jobs[0].id;
  const result = await f.service.settled(id);
  return result.jobs.find(job => job.id === id);
}

test('device paths are limited to shared storage, normalize aliases, and reject traversal outside it', () => {
  assert.equal(devicePath('/storage/emulated/0/Download/'), '/sdcard/Download');
  assert.equal(devicePath('/sdcard/a/../Download'), '/sdcard/Download');
  assert.equal(devicePath('/sdcard/'), '/sdcard');
  for (const path of ['/data/data', '/sdcard/../../data', '/sdcard-not-really/a', 'relative', '/sdcard/a\x00b']) assert.throws(() => devicePath(path));
  const command = listingCommand("/sdcard/it's $(literal)\nfolder");
  assert.ok(command.includes("p='/sdcard/it'\\''s $(literal)\nfolder';"));
  assert.ok(command.includes('realpath')); assert.ok(command.includes('BKFM_OUTSIDE_STORAGE'));
});

test('NUL listings preserve Chinese, spaces, tabs, newlines and distinguish symlinks', () => {
  const output='BKFM1\x00中文 a\nb\t.txt\x0081a4 123 1700000000\n\x00folder\x0041ed 0 1700000000\n\x00link\x00a1ff 0 1700000000\n\x00';
  const entries=parseListing(output,'/sdcard');
  assert.equal(entries[0].name,'中文 a\nb\t.txt'); assert.equal(entries[0].size,123);
  assert.equal(entries[1].type,'directory'); assert.equal(entries[2].type,'symlink');
  for (const output of ['broken','BKFM1\x00incomplete\x00','BKFM1\x00../bad\x0081a4 2 3\x00']) assert.throws(()=>parseListing(output,'/sdcard'));
});

test('portable names handle Windows reserved names, control characters and Unicode byte limits', () => {
  assert.equal(portableName('CON.txt'),'_CON.txt');
  assert.equal(portableName('a:b?c*.txt'),'a_b_c_.txt');
  assert.equal(portableName('abc.  '),'abc');
  assert.ok(Buffer.byteLength(portableName('中文'.repeat(200)))<=200);
  assert.ok(!/[\\/]/.test(portableName('a/b\\c')));
});

test('directory browsing is authorized and preserves metadata without downloading anything', async t => {
  const f=await fixture(t);
  const listing=await f.service.list({serial:'phone-1',path:'/sdcard/Download'});
  assert.equal(listing.entries.length,3); assert.equal(listing.entries[0].name,'中文 space.txt');
  assert.deepEqual(await readdir(f.destination),[]);
  f.devices[0].state='unauthorized';
  await assert.rejects(f.service.list({serial:'phone-1',path:'/sdcard'}),/未连接或尚未授权/);
});

test('a file downloads through staging, preserves content, and atomically avoids existing names', async t => {
  const f=await fixture(t); await writeFile(join(f.destination,'中文 space.txt'),'keep existing');
  const job=await download(f,['/sdcard/Download/中文 space.txt']);
  assert.equal(job.phase,'completed'); assert.equal(job.completedFiles,1);
  assert.equal(await readFile(join(f.destination,'中文 space.txt'),'utf8'),'keep existing');
  assert.equal(await readFile(join(f.destination,'中文 space (1).txt'),'utf8'),'hello 中文');
  assert.deepEqual((await readdir(f.destination)).sort(),['中文 space (1).txt','中文 space.txt']);
  assert.equal(await f.service.reveal(job.id),join(f.destination,'中文 space (1).txt'));
  const calls=(await readFile(f.log,'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(calls.every(call=>call[0]==='-s'&&call[1]==='phone-1'));
  assert.ok(calls.some(call=>call[2]==='pull'&&call[3]==='/sdcard/Download/中文 space.txt'));
});

test('folder downloads include empty/hidden files, sanitize names, skip links and deduplicate children', async t => {
  const f=await fixture(t);
  const job=await download(f,['/sdcard/Download/folder','/sdcard/Download/folder/a.txt','/sdcard/Download/empty']);
  assert.equal(job.phase,'completed'); assert.equal(job.selectedCount,2); assert.equal(job.totalFiles,3); assert.equal(job.skipped,1);
  assert.deepEqual((await readdir(join(f.destination,'folder'))).sort(),['.hidden','_CON.txt','a.txt']);
  assert.deepEqual(await readdir(join(f.destination,'empty')),[]);
  assert.equal(await readFile(join(f.destination,'folder/a.txt'),'utf8'),'alpha');
  assert.equal(job.transferredBytes,job.totalBytes);
  assert.ok(f.events.some(state=>state.jobs[0].phase==='finishing'));
});

test('existing folders remain unchanged and downloads get an independent numbered folder', async t => {
  const f=await fixture(t); await mkdir(join(f.destination,'empty')); await writeFile(join(f.destination,'empty/keep'),'original');
  const job=await download(f,['/sdcard/Download/empty']);
  assert.equal(job.phase,'completed'); assert.equal(await readFile(join(f.destination,'empty/keep'),'utf8'),'original');
  assert.deepEqual(await readdir(join(f.destination,'empty (1)')),[]);
});

test('permission denied is actionable and publishes no partial folder', async t => {
  const f=await fixture(t); f.config.tree['/sdcard/Download/folder'].denied=true; await writeFile(f.configPath,JSON.stringify(f.config));
  await assert.rejects(f.service.list({serial:'phone-1',path:'/sdcard/Download/folder'}),/系统不允许/);
  const job=await download(f,['/sdcard/Download/folder']);
  assert.equal(job.phase,'failed'); assert.match(job.message,/系统不允许/); assert.deepEqual(await readdir(f.destination),[]);
});

for(const option of ['pullFailure','wrongSize']) {
  test(`failed ${option} downloads clean staging and are never reported as complete`, async t => {
    const f=await fixture(t,{[option]:true});
    const job=await download(f,['/sdcard/Download/中文 space.txt']);
    assert.equal(job.phase,'failed'); assert.deepEqual(await readdir(f.destination),[]);
    await assert.rejects(f.service.reveal(job.id),/尚未完成/);
  });
}

test('cancelling during an actual pull aborts the process, cleans temporary bytes and allows a new job', async t => {
  const f=await fixture(t,{slow:true});
  const state=f.service.download({serial:'phone-1',destination:f.destination,paths:['/sdcard/Download/中文 space.txt']});
  const id=state.jobs[0].id;
  assert.throws(()=>f.service.download({serial:'phone-1',destination:f.destination,paths:['/sdcard/Download/empty']}),/已有下载/);
  const deadline=Date.now()+10000;
  while(!f.events.some(state=>state.jobs[0].transferredBytes>0)) {
    if(Date.now()>deadline) assert.fail('Pull did not report real progress');
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  f.service.cancel(id); const job=(await f.service.settled(id)).jobs[0];
  assert.equal(job.phase,'canceled'); assert.deepEqual(await readdir(f.destination),[]);
  f.config.slow=false; await writeFile(f.configPath,JSON.stringify(f.config));
  assert.equal((await download(f,['/sdcard/Download/empty'])).phase,'completed');
});

test('a disconnected selected phone never falls back to another device', async t => {
  const f=await fixture(t); f.devices.shift();
  const job=await download(f,['/sdcard/Download/empty']);
  assert.equal(job.phase,'failed'); await assert.rejects(readFile(f.log),{code:'ENOENT'});
  assert.deepEqual(await readdir(f.destination),[]);
});

test('invalid paths, destination and selection sizes are rejected before creating a transfer', async t => {
  const f=await fixture(t);
  for(const input of [{paths:[]},{paths:['/data/data']},{paths:Array(201).fill('/sdcard')},{paths:['/sdcard'],destination:'relative'}]) assert.throws(()=>f.service.download({serial:'phone-1',destination:f.destination,...input}));
  assert.equal(f.service.state().jobs.length,0);
});


test('a file colliding with an existing folder is numbered without modifying that folder', async t => {
  const f=await fixture(t); await mkdir(join(f.destination,'中文 space.txt'));
  await writeFile(join(f.destination,'中文 space.txt/keep'),'existing content');
  const job=await download(f,['/sdcard/Download/中文 space.txt']);
  assert.equal(job.phase,'completed');
  assert.equal(await readFile(join(f.destination,'中文 space.txt/keep'),'utf8'),'existing content');
  assert.equal(await readFile(join(f.destination,'中文 space (1).txt'),'utf8'),'hello 中文');
});

test('directly selected symlinks are rejected instead of following their targets', async t => {
  const f=await fixture(t);
  const job=await download(f,['/sdcard/Download/folder/skip-link']);
  assert.equal(job.phase,'failed'); assert.match(job.message,/符号链接/);
  assert.deepEqual(await readdir(f.destination),[]);
});

test('service shutdown waits for an active transfer to abort and remove partial data', async t => {
  const f=await fixture(t,{slow:true});
  f.service.download({serial:'phone-1',destination:f.destination,paths:['/sdcard/Download/中文 space.txt']});
  const deadline=Date.now()+10000;
  while(!f.events.some(state=>state.jobs[0].transferredBytes>0)) {
    if(Date.now()>deadline) assert.fail('No partial transfer');
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  await f.service.stop();
  assert.equal(f.service.isBusy(),false);
  assert.equal(f.service.state().jobs[0].phase,'canceled');
  assert.deepEqual(await readdir(f.destination),[]);
});
