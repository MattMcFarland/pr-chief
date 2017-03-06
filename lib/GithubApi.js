const https = require('https')
const url = require('url')
const HttpsProxyAgent = require('https-proxy-agent')

function GithubApi (initialOptions) {
  const config = Object.assign({}, initialOptions, { hostname: 'api.github.com' })
  const proxy = process.env.https_proxy || process.env.HTTPS_PROXY
  if (proxy) {
    config.agent = new HttpsProxyAgent(proxy);
  }

  function request (options) {
    const requestOptions = Object.assign({}, options, config)
    return new Promise((resolve, reject) => {
      const req = https.request(requestOptions, response => {
        if (response.statusCode !== 200) reject(`Invalid reponse from github: ${response.statusCode}`)
        let data = ''
        response.on('data', buffer => {
          data += buffer
        })
        response.on('end', () => {
          try {
            let result = JSON.parse(data)
            resolve(result)
          } catch (e) {
            reject(e)
          }
        })
      })
      req.on('error', reject)
      req.end()
    })
  }

  return {
    request,
    get: path => request({ path }),
    put: path => request({ path, method: 'PUT' })
  }
}

module.exports = GithubApi
