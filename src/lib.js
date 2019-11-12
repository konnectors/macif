const { PassThrough } = require('stream')
const querystring = require('querystring')
const rawRequest = require('request')
const { log } = require('cozy-konnector-libs')
const flatten = require('lodash/flatten')
const request = require('request-promise-native')
const find = require('lodash/find')

const MATERNAL_ASSISTANT = 'G9'
const SCHOLAR_CERTIFICATE = 'G1'

const baseUrl = 'https://www.macif.fr'
const getCookie = key => find(jar.getCookies(baseUrl), x => x.key === key)

const userAgent =
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:62.0) Gecko/20100101 Firefox/62.0 Cozycloud'

const jar = request.jar()
const rq = request.defaults({ jar })

// Both need user interactions
const disabledCertificates = [MATERNAL_ASSISTANT, SCHOLAR_CERTIFICATE]

const lib = {}

lib.setupCookies = async () => {
  await rq({
    url:
      'https://www.macif.fr/assurance/particuliers/vos-espaces-macif/espace-assurance',
    headers: {
      'User-Agent': userAgent
    }
  })
}

lib.login = async (login, password) => {
  try {
    const qs = querystring.stringify({
      username: login,
      password: password
    })
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
    } catch (e2) {
      log('error', e.error || e.message || e)
      error = new Error('LOGIN_FAILED.PARSE_RESPONSE_ERROR')
    }
    if (error) {
      throw error
    } else {
      log('error', e.error || e.message || e)
      throw new Error('UNKNOWN_ERROR')
    }
  }

  const userId = getCookie('noprs').value
  const userToken = getCookie('token').value

  lib.userId = userId
  lib.token = userToken
}

lib.fetchInsuranceCertificates = () => {
  return lib.authorizedRequest({
    url: `https://ssm.macif.fr/internet-contrat-rest/personnes/${lib.userId}/attestations`
  })
}

lib.fetchPaymentNotices = () => {
  return lib.authorizedRequest({
    url: `https://ssm.macif.fr/internet-espaceclient-rest/personnes/${lib.userId}/document/avisecheance`
  })
}

lib.fetchPayments = () => {
  return lib.authorizedRequest({
    url: `https://ssm.macif.fr/internet-espaceclient-rest/situationscomptables/macif/?inForcer=true`
  })
}

lib.authorizedRequest = async options => {
  const finalOptions = {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${lib.token}`,
      'X-Auth-Token': `${lib.token}`,
      'X-User-Id': lib.userId,
      Connection: 'keep-alive',
      Pragma: 'no-cache',
      // necessary otherwise the server cuts the connexion
      'User-Agent': userAgent
    }
  }
  return rq(finalOptions)
}

lib.parseInsuranceCertificates = insuranceCertificatesPayload => {
  const insuranceCertificates =
    insuranceCertificatesPayload.data.eligibiliteAttestations
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
          token: lib.token
        })
        const url = `https://ssm.macif.fr/internet-contrat-rest/personnes/${lib.userId}/attestations/_telecharger_attestation?${qs}`
        return {
          filestream: lib.downloadFile(url),
          filename: `MACIF Attestation ${insuranceCertificate.znNmAttestation} ${info.noOrdreContrat}.pdf`
        }
      })
    })
  ).filter(x => x)
}

lib.parsePaymentNotices = paymentNoticesPayload => {
  const paymentNotices = paymentNoticesPayload.data
  log('info', `Found ${paymentNotices.length} payment notices`)
  return paymentNotices.map(paymentNotice => {
    const date = paymentNotice.dtAvisEcheance.slice(0, 10)
    const ref = paymentNotice.znRefPublicDocElec
    const url = `https://ssm.macif.fr/internet-espaceclient-rest/personnes/${lib.userId}/document/avisecheance/${ref}?token=${lib.token}`
    log('info', `Downloading payment notice for ${date} (${url})...`)
    return {
      filename: `MACIF Echeance ${date}.pdf`,
      filestream: lib.downloadFile(url)
    }
  })
}

lib.downloadFile = url => {
  return rawRequest({
    url,
    headers: {
      'User-Agent': userAgent
    }
  }).pipe(PassThrough())
}

module.exports = lib
