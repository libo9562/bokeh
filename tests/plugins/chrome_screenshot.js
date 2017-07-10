const CDP = require('chrome-remote-interface')

const path = require('path')
const fs = require('fs')

const mkdirp = require('mkdirp')

const {max, ceil} = Math

const argv = process.argv.slice(2)

const file = argv[0]
const is_url = file.startsWith("file://") || file.startsWith("http://") || file.startsWith("https://")
const url = is_url ? file : `file://${path.resolve(file)}`
const png = argv[1] || path.basename(file, ".html") + ".png"
const pause = parseInt(argv[2]) || 100
const timeout = parseInt(argv[3]) || 30000

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled rejection at: ', reason)
  process.exit(1)
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

CDP(async function(client) {
  const {Console, DOM, Emulation, Log, Page, Runtime} = client

  await Console.enable()
  await DOM.enable()
  await Log.enable()
  await Page.enable()
  await Runtime.enable()

  await Emulation.setDeviceMetricsOverride({width: 1000, height: 1000, deviceScaleFactor: 0, mobile: false})

  const messages = []
  const errors = []

  Console.messageAdded(({message}) => {
    if (message.level !== "debug") {
      const {text, line, column, url} = message
      messages.push({msg: text, line: line, source: url})
    }
  })

  Runtime.exceptionThrown(({exceptionDetails}) => {
    const {lineNumber, columnNumber, url, exception: {description}} = exceptionDetails
    errors.push({msg: description, trace: []})
  })

  Log.entryAdded(({entry}) => {
    if (entry.source === "network" && entry.level === "error") {
      errors.push({msg: entry.text, trace: []})
    }
  })

  async function screenshot() {
    await Runtime.evaluate({expression: "document.body.style.margin = 0"})

    const {result: {value: width}}  = await Runtime.evaluate({expression: "document.body.scrollWidth"})
    const {result: {value: height}} = await Runtime.evaluate({expression: "document.body.scrollHeight"})

    const adjust = (value, step=50) => ceil(value/step)*step
    const [adjusted_width, adjusted_heigth] = [adjust(width), adjust(height)]

    await Emulation.setDeviceMetricsOverride({width: adjusted_width, height: adjusted_heigth, deviceScaleFactor: 0, mobile: false})

    const image = await Page.captureScreenshot({format: "png"})
    const buffer = new Buffer(image.data, 'base64')
    mkdirp.sync(path.dirname(png))
    fs.writeFileSync(png, buffer, 'base64')
  }

  async function is_idle() {
    const script = "typeof Bokeh !== 'undefined' && Bokeh.documents.length !== 0 && Bokeh.documents[0].is_idle"
    const {result, exceptionDetails} = await Runtime.evaluate({expression: script})

    if (result.type === "boolean")
      return result.value
    else {
      errors.push({msg: result.description, trace: []})
      return null
    }
  }

  async function finish(timeout, success) {
    if (success)
      await screenshot()

    console.log(JSON.stringify({
      success: success,
      timeout: timeout,
      errors: errors,
      messages: messages,
      resources: [],
    }))

    await client.close()
  }

  Page.loadEventFired(async () => {
    if (errors.length > 0) {
      await finish(false, false)
    }
  })

  const result = await Page.navigate({url})
  if ("errorText" in result) {
    console.error(`Cannot load resource: ${url} (${result.errorText})`)
    process.exit(1)
  }

  for (let i = 0; i < timeout/pause; i++) {
    await wait(pause)
    const ret = await is_idle()

    if (ret === false)
      continue

    await finish(false, ret === true)
    return
  }

  await finish(true, false)
}).on('error', err => {
  console.error('Cannot connect to browser: ', err)
  process.exit(1)
})
