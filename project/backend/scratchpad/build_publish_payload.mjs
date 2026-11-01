import fs from 'node:fs'
import path from 'node:path'

const dir = 'export-source/dist'
function walk(d, base) {
  let out = []
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name)
    const rel = (base ? base + '/' : '') + e.name
    if (e.isDirectory()) out = out.concat(walk(full, rel))
    else out.push({ path: rel, contentBase64: fs.readFileSync(full).toString('base64') })
  }
  return out
}
const files = walk(dir, '')
fs.writeFileSync('publish-payload.json', JSON.stringify({ files }))
console.log('files:', files.map((f) => f.path))
