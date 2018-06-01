const querystring = require('querystring')
const rawRequest = require('request')
const request = require('request-promise-native')
const find = require('lodash/find')
const flatten = require('lodash/flatten')
const { BaseKonnector, saveFiles, log } = require('cozy-konnector-libs')

const jar = request.jar()
const rq = request.defaults({ jar })

module.exports = new BaseKonnector(start)

let userId, token

const baseUrl = 'https://www.macif.fr'
const getCookie = key => find(jar.getCookies(baseUrl), x => x.key === key)

async function authorizedRequest(options) {
  const finalOptions = {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      'X-Auth-Token': `${token}`,
      'X-User-Id': userId,
      Connection: 'keep-alive',
      Pragma: 'no-cache',
      // necessary otherwise the server cuts the connexion
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.181 Safari/537.36'
    }
  }
  return rq(finalOptions)
}

const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.181 Safari/537.36'

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in. User id: ' + userId)
  const paymentNotices = await fetchPaymentNotices()
  const insuranceCertificates = await fetchInsuranceCertificates()
  await saveFiles([...paymentNotices, ...insuranceCertificates], {
    folderPath: fields.folderPath,
    contentType: 'application/pdf'
  })
}

// this shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
async function authenticate(login, password) {
  // setup cookies
  log('info', 'Setup cookies...')
  await rq({
    url:
      'https://www.macif.fr/assurance/particuliers/vos-espaces-macif/espace-assurance'
  })
  const qs = querystring.stringify({
    username: login,
    password: password
  })
  log('info', 'Logging in...')
  try {
    await rq({
      url: 'https://www.macif.fr/cms/ajax/login?' + qs,
      headers: {
        Origin: 'https://www.macif.fr',
        'User-Agent': userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json, text/plain, */*',
        'Cache-Control': 'no-cache',
        'X-Code-Application': '1880',
        'X-JS-LOADING': 'loading_authorized',
        'X-No-Struct': '324'
      }
    })
  } catch (e) {
    let error
    try {
      const data = JSON.parse(e.error)
      if (
        data.errors &&
        data.errors.length > 0 &&
        data.errors[0].message.includes('Identifiant ou mot de passe incorrect')
      ) {
        error = new Error('LOGIN_FAILED')
      }
    } catch (e) {
      error = new Error('LOGIN_FAILED.PARSE_RESPONSE_ERROR')
    }
    if (error) {
      throw error
    } else {
      log('error', e.error || e.message || e)
      throw new Error('UNKNOWN_ERROR')
    }
  }

  userId = getCookie('noprs').value
  token = getCookie('token').value
}

const downloadFile = url => {
  return rawRequest({
    url,
    headers: {
      'User-Agent': userAgent
    }
  }).pipe(require('stream').PassThrough())
}

async function fetchPaymentNotices() {
  const res = JSON.parse(
    await authorizedRequest({
      url: `https://ssm.macif.fr/internet-espaceclient-rest/personnes/${userId}/document/avisecheance`
    })
  )
  const paymentNotices = res.data
  log('info', `Found ${paymentNotices.length} payment notices`)
  return paymentNotices.map(async paymentNotice => {
    const date = paymentNotice.dtAvisEcheance.slice(0, 10)
    const ref = paymentNotice.znRefPublicDocElec
    const url = `https://ssm.macif.fr/internet-espaceclient-rest/personnes/${userId}/document/avisecheance/${ref}?token=${token}`
    log('info', `Downloading payment notice for ${date} (${url})...`)
    return {
      filename: `MACIF Echeance ${date}.pdf`,
      filestream: downloadFile(url)
    }
  })
}

const MATERNAL_ASSISTANT = 'G9'
const SCHOLAR_CERTIFICATE = 'G1'

// Both need user interactions
const disabledCertificates = [MATERNAL_ASSISTANT, SCHOLAR_CERTIFICATE]

async function fetchInsuranceCertificates() {
  const res = JSON.parse(
    await authorizedRequest({
      url: `https://ssm.macif.fr/internet-contrat-rest/personnes/${userId}/attestations`
    })
  )
  const insuranceCertificates = res.data.eligibiliteAttestations
  log('info', `Found ${insuranceCertificates.length} insurance certificates`)
  return flatten(
    insuranceCertificates.map(insuranceCertificate => {
      if (
        disabledCertificates.includes(insuranceCertificate.cdGroupeAttestation)
      ) {
        return
      }
      return insuranceCertificate.contratEligibiliteAttestations.map(info => {
        const qs = querystring.stringify({
          cdObjAssu: info.cdObjAssu,
          cdProdAssu: info.cdProdAssu,
          noInt: info.noInt,
          noOrdreContrat: info.noOrdreContrat,
          znNmAttestation: insuranceCertificate.znNmAttestation,
          token: token
        })
        const url = `https://ssm.macif.fr/internet-contrat-rest/personnes/${userId}/attestations/_telecharger_attestation?${qs}`
        return {
          filestream: downloadFile(url),
          filename: `MACIF Attestation ${
            insuranceCertificate.znNmAttestation
          } ${info.noOrdreContrat}.pdf`
        }
      })
    })
  ).filter(x => x)
}
