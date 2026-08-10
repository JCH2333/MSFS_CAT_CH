const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const project = path.resolve(__dirname, '..')
const python = process.env.PYTHON || 'python'
const tool = path.join(project, 'tools', 'gsx-image-localizer', 'gsx_image_localizer.py')
const hasPillow = spawnSync(python, ['-c', 'import PIL']).status === 0

function run(args, expected = 0) {
  const result = spawnSync(python, [tool, ...args], { encoding: 'utf8' })
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`)
  return result
}

function png(destination) {
  execFileSync(python, ['-c', [
    'from PIL import Image, ImageDraw',
    'import sys',
    'im=Image.new("RGBA",(150,32),(210,210,210,255));d=ImageDraw.Draw(im);d.text((8,8),"Select",fill=(20,20,20,255));im.save(sys.argv[1])',
  ].join(';'), destination])
}

test('GSX image tool backs up, detects source drift, builds and validates output', { skip: !hasPillow }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsx-image-localizer-'))
  const runtime = path.join(temp, 'res')
  const backups = path.join(temp, 'backups')
  const output = path.join(temp, 'output')
  fs.mkdirSync(path.join(runtime, 'fonts'), { recursive: true })
  png(path.join(runtime, 'btn_select.png'))
  png(path.join(runtime, 'btn_select_hover.png'))
  fs.writeFileSync(path.join(runtime, 'resources.xrc'), '<resource/>')
  run(['--runtime', runtime, '--version', '4.0.15', '--backup-root', backups, 'backup'])
  const manifest = JSON.parse(fs.readFileSync(path.join(backups, '4.0.15', 'backup-manifest.json'), 'utf8'))
  assert.equal(manifest.files.length, 3)
  run(['--runtime', runtime, '--version', '4.0.15', '--backup-root', backups, 'verify-backup'])
  run(['--runtime', runtime, '--version', '4.0.15', '--backup-root', backups, '--output', output, 'build'])
  run(['--runtime', runtime, '--version', '4.0.15', '--output', output, 'verify-output'])
  fs.appendFileSync(path.join(runtime, 'btn_select.png'), 'changed')
  run(['--runtime', runtime, '--version', '4.0.15', '--backup-root', backups, '--output', output, 'build'], 1)
})
