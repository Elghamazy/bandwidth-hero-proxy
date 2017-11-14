#!/usr/bin/env node
'use strict'
const opbeat = require('opbeat')
if (process.env.OPBEAT_APP_ID) {
  opbeat.start({
    appId: process.env.OPBEAT_APP_ID,
    organizationId: process.env.OPBEAT_ORG_ID,
    secretToken: process.env.OPBEAT_TOKEN
  })
}
const auth = require('basic-auth')
const Express = require('express')
const Request = require('request')
const Sharp = require('sharp')

const PORT = process.env.PORT
const LOGIN = process.env.LOGIN
const PASSWORD = process.env.PASSWORD
const DEFAULT_QUALITY = 40
const DEFAULT_TIMEOUT = 5000
const MIN_COMPRESS_LENGTH = 512
const MIN_TRANSPARENT_COMPRESS_LENGTH = 100000
const USER_AGENT = 'Bandwidth-Hero Compressor'

const app = Express()

app.enable('trust proxy')
app.get('/', (req, res) => {
  req.on('error', err => {
    console.error('req error', err)
    res.status(400)
    res.end()
  })
  res.on('error', err => console.error('res error', err))
  if (LOGIN && PASSWORD) {
    const credentials = auth(req)
    if (!credentials || credentials.name !== LOGIN || credentials.pass !== PASSWORD) {
      res.setHeader('WWW-Authenticate', `Basic realm="${USER_AGENT}"`)

      return res.status(401).end('Access denied')
    }
  }

  let imageUrl = req.query.url
  if (Array.isArray(imageUrl)) imageUrl = imageUrl.join('&url=')
  if (!imageUrl) {
    res.setHeader('Location', 'https://bandwidth-hero.com')
    return res.status(302).end()
  }
  const headers = {
    'User-Agent': USER_AGENT
  }
  headers['X-Forwarded-For'] = req.headers['X-Forwarded-For']
    ? `${req.ip}, ${req.headers['X-Forwarded-For']}`
    : req.ip
  if (req.headers.cookie) headers['Cookie'] = req.headers.cookie
  if (req.headers.dnt) headers['DNT'] = req.headers.dnt

  Request.get(
    imageUrl,
    {
      headers,
      timeout: DEFAULT_TIMEOUT,
      encoding: null,
      jar: true,
      maxRedirects: 5
    },
    (err, proxied, image) => {
      if ((err || proxied.statusCode !== 200) && !res.headersSent) {
        res.setHeader('Location', encodeURI(`${imageUrl}#bh-no-compress=1`))
        return res.status(302).end()
      }

      const type = proxied.headers['content-type']
      const length = proxied.headers['content-length']
      const supportsWebp = !req.query.jpeg
      if (shouldCompress(type, length, supportsWebp)) {
        const format = supportsWebp ? 'webp' : 'jpeg'

        Sharp(image)
          .grayscale(req.query.bw != 0)
          .toFormat(format, {
            quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY
          })
          .toBuffer((err, compressedImage, info) => {
            if (err || !info || res.headersSent) return res.status(400).end()
            copyHeaders(proxied, res)
            res.setHeader('Content-Type', `image/${format}`)
            res.setHeader('Content-Length', info.size)
            res.setHeader('X-Original-Size', length)
            res.setHeader('X-Bytes-Saved', length - info.size)
            res.status(200)
            res.write(compressedImage)
            res.end()
          })
      } else {
        copyHeaders(proxied, res)
        res.setHeader('X-Proxy-Bypass', 1)
        res.status(200)
        res.write(image)
        res.end()
      }
    }
  )
})

function shouldCompress(type = '', length = 0, supportsWebp) {
  if (!type.startsWith('image')) return false
  if (length === 0) return false
  if (supportsWebp && length < MIN_COMPRESS_LENGTH) return false
  if (
    !supportsWebp &&
    (type.endsWith('png') || type.endsWith('gif')) &&
    length < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false
  }

  return true
}

function copyHeaders(from, to) {
  for (const header in from.headers) {
    try {
      to.setHeader(header, from.headers[header])
    } catch (e) {
      console.log(e)
    }
  }
}

if (process.env.OPBEAT_APP_ID) app.use(opbeat.middleware.express())
if (PORT > 0) app.listen(PORT, () => console.log(`Listening on ${PORT}`))

module.exports = app
