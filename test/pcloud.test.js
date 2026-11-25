import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../supabase/functions/uren/pcloud.ts';

// Nagebootste pCloud-server: houdt bij welke aanroepen er binnenkomen.
function nepServer(bestanden = []) {
  const aanroepen = [];
  const f = async (url, init) => {
    const u = new URL(url);
    const methode = u.pathname.slice(1);
    aanroepen.push({ host: u.host, methode, params: Object.fromEntries(u.searchParams), init });
    const json = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (u.searchParams.get('access_token') !== 'goed') return json({ result: 2094, error: "Invalid 'access_token' provided." });
    if (methode === 'userinfo') return json({ result: 0, email: 'test@example.invalid' });
    if (methode === 'createfolderifnotexists') return json({ result: 0, metadata: { folderid: 77, name: 'Uren backup' } });
    if (methode === 'uploadfile') return json({ result: 0, metadata: [{ name: 'x' }] });
    if (methode === 'listfolder') return json({ result: 0, metadata: { contents: bestanden } });
    if (methode === 'deletefile') return json({ result: 0 });
    return json({ result: 1000, error: 'onbekend' });
  };
  return { f, aanroepen };
}

test('token controleren', async () => {
  const { f } = nepServer();
  assert.equal(await P.controleerToken('eapi.pcloud.com', 'goed', f), 'test@example.invalid');
  await assert.rejects(P.controleerToken('eapi.pcloud.com', 'fout', f), /Invalid 'access_token'/);
});

test('alleen bekende pCloud-servers', async () => {
  const { f, aanroepen } = nepServer();
  await assert.rejects(P.controleerToken('aanvaller.example', 'goed', f), /Onbekende pCloud-server/);
  assert.equal(aanroepen.length, 0);
});

test('back-up: map, upload naar die map, opruimen van alles na de laatste 60', async () => {
  const datums = Array.from({ length: 63 }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10));
  const bestanden = [
    ...datums.map((d, i) => ({ name: `uren-${d}.json`, fileid: 1000 + i, isfolder: false })),
    { name: 'notities.txt', fileid: 5, isfolder: false },
    { name: 'uren-oud', fileid: 6, isfolder: true },
  ];
  const { f, aanroepen } = nepServer(bestanden);
  const res = await P.zetBackup('eapi.pcloud.com', 'goed', 'uren-2027-03-04.json', '{"a":1}', f);
  assert.equal(res.verwijderd, 3);
  const upload = aanroepen.find((a) => a.methode === 'uploadfile');
  assert.equal(upload.params.folderid, '77');
  assert.equal(upload.params.nopartial, '1');
  assert.equal(upload.init.method, 'POST');
  const bestand = upload.init.body.get('file');
  assert.equal(bestand.name, 'uren-2027-03-04.json');
  assert.equal(await bestand.text(), '{"a":1}');
  const weg = aanroepen.filter((a) => a.methode === 'deletefile').map((a) => Number(a.params.fileid)).sort();
  assert.deepEqual(weg, [1000, 1001, 1002]); // de drie oudste back-ups, niets anders
});
