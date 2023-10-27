import { ContentScript } from 'cozy-clisk/dist/contentscript'
import Minilog from '@cozy/minilog'
import waitFor, { TimeoutError } from 'p-wait-for'
import { parse } from 'date-fns'
const log = Minilog('ContentScript')
Minilog.enable('macifCCC')

const baseUrl = 'https://www.macif.fr'
// let FORCE_FETCH_ALL = false

const personnalInfos = []
const personIdentity = []
const attestationsInfos = []
const schedulesInfos = []

var openProxied = window.XMLHttpRequest.prototype.open
window.XMLHttpRequest.prototype.open = function () {
  var originalResponse = this
  if (arguments[1].includes('/espace-client/contacts/macif')) {
    originalResponse.addEventListener('readystatechange', function () {
      if (originalResponse.readyState === 4) {
        const jsonInfos = JSON.parse(originalResponse.responseText)
        personnalInfos.push(jsonInfos)
      }
    })
    return openProxied.apply(this, [].slice.call(arguments))
  }
  if (arguments[1].match(/\/internet-personne-rest\/personnes\/\d+/g)) {
    originalResponse.addEventListener('readystatechange', function () {
      if (originalResponse.readyState === 4) {
        const jsonInfos = JSON.parse(originalResponse.responseText)
        personIdentity.push(jsonInfos)
      }
    })
    return openProxied.apply(this, [].slice.call(arguments))
  }
  return openProxied.apply(this, [].slice.call(arguments))
}

const fetchOriginal = window.fetch
window.fetch = async (...args) => {
  const response = await fetchOriginal(...args)
  if (
    args[0].url &&
    args[0].url === 'https://ssm.macif.fr/internet-contrat-rest/v2/attestations'
  ) {
    await response
      .clone()
      .json()
      .then(body => {
        attestationsInfos.push(body)
        return response
      })
      .catch(err => {
        // eslint-disable-next-line no-console
        console.log(err)
        return response
      })
  }
  if (
    args[0].url &&
    args[0].url ===
      'https://ssm.macif.fr/internet-espaceclient-rest/personnes/1/document/avisecheance'
  ) {
    await response
      .clone()
      .json()
      .then(body => {
        schedulesInfos.push(body)
        return response
      })
      .catch(err => {
        // eslint-disable-next-line no-console
        console.log(err)
        return response
      })
  }
  return response
}

class MacifContentScript extends ContentScript {
  onWorkerReady() {
    window.addEventListener('DOMContentLoaded', () => {
      const button = document.querySelector('input[type=submit]')
      if (button) {
        button.addEventListener('click', () =>
          this.bridge.emit('workerEvent', { event: 'loginSubmit' })
        )
      }
      const error = document.querySelector('.error')
      if (error) {
        this.bridge.emit('workerEvent', {
          event: 'loginError',
          payload: { msg: error.innerHTML }
        })
      }
    })
  }

  onWorkerEvent({ event, payload }) {
    if (event === 'loginSubmit') {
      this.log('info', 'received loginSubmit, blocking user interactions')
      this.blockWorkerInteractions()
    } else if (event === 'loginError') {
      this.log(
        'info',
        'received loginError, unblocking user interactions: ' + payload?.msg
      )
      this.unblockWorkerInteractions()
    }
  }

  async navigateToLoginForm() {
    this.log('info', '🤖 navigateToLoginForm')
    await this.goto(baseUrl)
    await this.waitForElementInWorker('#Part_Vos-espaces_EspAss')
    await this.runInWorker('click', '#Part_Vos-espaces_EspAss')
    await Promise.race([
      this.waitForElementInWorker('#login'),
      this.waitForElementInWorker('button[data-logout]')
    ])
  }

  async ensureAuthenticated({ account }) {
    this.bridge.addEventListener('workerEvent', this.onWorkerEvent.bind(this))
    this.log('info', '🤖 ensureAuthenticated')
    // if (!account) {
    //   await this.ensureNotAuthenticated()
    // }
    if (!(await this.isElementInWorker('#login'))) {
      await this.navigateToLoginForm()
    }
    const authenticated = await this.runInWorker('checkAuthenticated')
    if (!authenticated) {
      this.log('info', 'Not authenticated')
      await this.showLoginFormAndWaitForAuthentication()
    }
    this.unblockWorkerInteractions()
    return true
  }

  async ensureNotAuthenticated() {
    this.log('info', '🤖 ensureNotAuthenticated')
    await this.navigateToLoginForm()
    const authenticated = await this.runInWorker('checkAuthenticated')
    if (!authenticated) {
      return true
    }
    await this.clickAndWait(
      'button[data-logout]',
      'button[data-target="#mcf-sidebar-connexion"]'
    )
    return true
  }

  async checkAuthenticated() {
    this.log('info', '🤖 checkAuthenticated')
    return Boolean(document.querySelector('button[data-logout]'))
  }

  async showLoginFormAndWaitForAuthentication() {
    this.log('info', '🤖 showLoginFormAndWaitForAuthentication start')
    await this.setWorkerState({ visible: true })
    await this.runInWorkerUntilTrue({
      method: 'waitForAuthenticated'
    })
    await this.setWorkerState({ visible: false })
  }

  async getUserDataFromWebsite() {
    this.log('info', '🤖 getUserDataFromWebsite')
    await this.clickAndWait(
      'a[href="/assurance/particuliers/vos-espaces-macif/espace-assurance/infos-persos"]',
      'a[href="/assurance/particuliers/vos-espaces-macif/espace-assurance/infos-persos/modifier-email"]'
    )
    await this.runInWorkerUntilTrue({
      method: 'checkInterceptions',
      args: ['personnalInfos']
    })
    await this.runInWorker('getIdentity')
    if (this.store.userIdentity) {
      return { sourceAccountIdentifier: this.store.userIdentity.email }
    } else {
      throw new Error(
        'No source account identifier found, the konnector should be fixed'
      )
    }
  }

  async fetch(context) {
    this.log('info', '🤖 fetch')
    // For now with the account we use to develop, it has been decide to not use FORCE_FETCH_ALL as the execution is pretty quick in every case
    // Keeping this around for later use, when we'll get more use cases with other accounts.
    // await this.determineForceFetchAll(context)
    if (this.store.userCredentials) {
      this.log('info', 'Saving credentials ...')
      await this.saveCredentials(this.store.userCredentials)
    }
    if (this.store.userIdentity) {
      this.log('info', 'Saving identity ...')
      await this.saveIdentity({ contact: this.store.userIdentity })
    }
    await this.navigateToBillsPage()
    await this.runInWorkerUntilTrue({
      method: 'checkInterceptions',
      args: ['attestations']
    })
    const { carAttestations, otherAttestations } = await this.runInWorker(
      'getAttestations'
    )
    // Here we cannot use Promise.all because we're creating the subPath with both functions
    // at the same time approx. leading to conflicts. Doing so, the subPath creation is done just once
    await this.saveFiles(carAttestations, {
      context,
      contentType: 'application/pdf',
      fileIdAttributes: ['filename'],
      qualificationLabel: 'car_insurance',
      subPath: 'Attestations'
    })
    await this.saveFiles(otherAttestations, {
      context,
      contentType: 'application/pdf',
      fileIdAttributes: ['filename'],
      // Cannot find an appropriate qualifications, has to be discuss
      subPath: 'Attestations'
    })
    await this.runInWorkerUntilTrue({
      method: 'checkInterceptions',
      args: ['schedules']
    })
    const allSchedules = await this.runInWorker('getPaymentSchedules')
    // The page we reach here is to be on the same domain as the fileurl we get for downloading
    // It is expected to get an error in the HTML of this page, "missing ressource" or "bad request"
    // but it is on purpose, otherwise, schedules downloads cannot be achieved
    await this.goto(
      'https://ssm.macif.fr/internet-espaceclient-rest/personnes/'
    )
    await this.runInWorkerUntilTrue({ method: 'checkDomainChange' })
    await this.saveFiles(allSchedules, {
      context,
      contentType: 'application/pdf',
      fileIdAttributes: ['filename'],
      qualificationLabel: 'other_invoice',
      subPath: "Avis d'échéances"
    })
  }

  async checkInterceptions(option) {
    this.log('info', `📍️ checkInterceptions for ${option} starts`)
    await waitFor(
      () => {
        if (option === 'personnalInfos') {
          return Boolean(personnalInfos.length > 0 && personIdentity.length > 0)
        }
        if (option === 'attestations') {
          return Boolean(attestationsInfos.length > 0)
        }
        if (option === 'schedules') {
          return Boolean(schedulesInfos.length > 0)
        }
      },
      {
        interval: 1000,
        timeout: {
          milliseconds: 30 * 1000,
          message: new TimeoutError(
            `checkInterception for ${option} timed out after 30000ms, verify XHR interceptions`
          )
        }
      }
    )
    this.log('info', `Interception for ${option} - OK`)
    return true
  }

  async getIdentity() {
    this.log('info', '📍️ getIdentity starts')
    const infos = personnalInfos[0].data
    const identity = personIdentity[0].data
    const userIdentity = {
      email: infos.znAdrEmail,
      name: {
        givenName: identity.znPrenPers,
        familyName: identity.nmPers
      },
      address: this.getAddresses(infos.adresses),
      phone: this.getPhones(infos.telephones)
    }
    await this.sendToPilot({ userIdentity })
  }

  getAddresses(addressesArray) {
    this.log('info', '📍️ getAddresses starts')
    const allAddresses = []
    for (const address of addressesArray) {
      let foundAddress = {}
      let formattedAddress = ''
      if (address.noVoiePers) {
        foundAddress.streetNumber = address.noVoiePers
      }
      if (address.cdNoVoie) {
        foundAddress.streetSuffix = address.cdNoVoie
      }
      if (address.cdNatuVoie) {
        foundAddress.streetType = address.cdNatuVoie
      }
      if (address.noBatPers) {
        foundAddress.building = address.noBatPers
      }
      if (address.noEntreePers) {
        foundAddress.buildingEntrance = address.noEntreePers
      }
      if (address.noEscaPers) {
        foundAddress.staircaseNumber = address.noEscaPers
      }
      if (address.noAppartPers) {
        foundAddress.apartmentNumber = address.noAppartPers
      }
      if (address.nmLieuDitPers) {
        foundAddress.locality = address.nmLieuDitPers
      }
      if (address.cdPost) {
        foundAddress.postCode = address.cdPost
      }
      if (address.nmCommuPers) {
        foundAddress.city = address.nmCommuPers
      }
      if (address.liPays) {
        foundAddress.country = address.liPays
      }
      if (address.znAdrLigne1) {
        formattedAddress = `${address.znAdrLigne1} `
      }
      if (address.znAdrLigne2) {
        formattedAddress = `${formattedAddress}${address.znAdrLigne2} `
      }
      if (address.znAdrLigne3) {
        formattedAddress = `${formattedAddress}${address.znAdrLigne3} `
      }
      if (address.znAdrLigne4) {
        formattedAddress = `${formattedAddress}${address.znAdrLigne4} `
      }
      if (address.znAdrLigne5) {
        formattedAddress = `${formattedAddress}${address.znAdrLigne5} `
      }
      if (address.znAdrLigne6) {
        formattedAddress = `${formattedAddress}${address.znAdrLigne6} `
      }
      foundAddress.formattedAddress = formattedAddress
      allAddresses.push(foundAddress)
    }
    return allAddresses
  }

  getPhones(phoneArray) {
    this.log('info', '📍️ getPhones starts')
    const allPhones = []
    for (const phoneInfos of phoneArray) {
      let foundPhone = {
        number: phoneInfos.noTeleLigne,
        type: phoneInfos.liLieuAppelTele === 'Personnel' ? 'mobile' : 'home'
      }
      allPhones.push(foundPhone)
    }
    return allPhones
  }

  // async determineForceFetchAll(context) {
  //   this.log('info', '📍️ determineForceFetchAll starts')
  //   const { trigger } = context
  //   const isLastJobError =
  //     trigger.current_state?.last_failure > trigger.current_state?.last_success
  //   const hasLastExecution = Boolean(trigger.current_state?.last_execution)
  //   const distanceInDays = getDateDistanceInDays(
  //     trigger.current_state?.last_execution
  //   )
  //   if (distanceInDays >= 30 || !hasLastExecution || isLastJobError) {
  //     this.log('debug', `isLastJobError: ${isLastJobError}`)
  //     this.log('debug', `distanceInDays: ${distanceInDays}`)
  //     this.log('debug', `hasLastExecution: ${hasLastExecution}`)
  //     FORCE_FETCH_ALL = true
  //   }
  // }

  async navigateToBillsPage() {
    this.log('info', '📍️ navigateToBillsPage starts')
    await this.runInWorker(
      'click',
      'a[href="/assurance/particuliers/vos-espaces-macif/espace-assurance/documents"]'
    )
    await Promise.all([
      this.waitForElementInWorker('#avisecheances'),
      this.waitForElementInWorker('#attestations')
    ])
  }

  async getAttestations() {
    this.log('info', '📍️ getAttestations starts')
    const allAttestationsInfos = attestationsInfos[0].data
    const carAttestations = []
    const otherAttestations = []
    for (const attestations of allAttestationsInfos) {
      const attestationsForOneType = []
      for (const oneAttestation of attestations.listeAttestations) {
        const type = attestations.libelle
        const filename = `${
          oneAttestation.liAttestSoc
        }_MACIF_${oneAttestation.libelle.replace(/ /g, '-')}.pdf`
        const fileurl = `${baseUrl}${oneAttestation.lien}`
        const attestation = {
          documentType: type,
          filename,
          fileurl,
          shouldReplaceFile: () => true,
          date: new Date(),
          vendor: 'MACIF',
          fileAttributes: {
            metadata: {
              contentAuthor: 'macif',
              issueDate: new Date(),
              datetime: new Date(),
              datetimeLabel: 'issueDate',
              carbonCopy: true
            }
          }
        }
        attestationsForOneType.push(attestation)
      }
      if (
        attestationsForOneType[0]?.documentType
          .toLowerCase()
          .includes('véhicule')
      ) {
        carAttestations.push(...attestationsForOneType)
      } else {
        otherAttestations.push(...attestationsForOneType)
      }
    }
    return { carAttestations, otherAttestations }
  }

  async getPaymentSchedules() {
    this.log('info', '📍️ getPaymentSchedules starts')
    const foundPaymentSchedules = document.querySelectorAll(
      'a[href*="https://ssm.macif.fr/internet-espaceclient-rest/personnes/1/document/avisecheance/"]'
    )
    const allPaymentSchedules = []
    for (const paymentSchedule of foundPaymentSchedules) {
      const titleAndDateElements = paymentSchedule.querySelectorAll('p')
      this.log(
        'info',
        `titleAndDateElements.length : ${titleAndDateElements.length}`
      )
      const fileTitle = titleAndDateElements[0].textContent
      const foundDate = titleAndDateElements[1].textContent
      const parsedDate = parse(foundDate, 'dd/MM/yyyy', new Date())
      const fileurl = paymentSchedule.getAttribute('href')
      const vendorRef = fileurl.split('/').pop()
      const filename = `${fileTitle}_MACIF.pdf`
      const onePaymentSchedule = {
        filename,
        vendorRef,
        date: parsedDate,
        fileurl,
        fileIdAttributes: ['vendorRef'],
        vendor: 'MACIF',
        fileAttributes: {
          metadata: {
            contentAuthor: 'macif.fr',
            issueDate: new Date(),
            datetime: parsedDate,
            datetimeLabel: 'issueDate',
            isSubscription: true,
            carbonCopy: true
          }
        }
      }
      allPaymentSchedules.push(onePaymentSchedule)
    }
    return allPaymentSchedules
  }

  async checkDomainChange() {
    this.log('info', '📍️ checkDomainChange starts')
    await waitFor(
      () => {
        const titleElement = document.querySelector('h1')
        if (
          titleElement?.textContent.includes('Requête') ||
          titleElement?.textContent.includes('Ressource')
        ) {
          return true
        } else {
          return false
        }
      },
      {
        interval: 1000,
        timeout: 30 * 1000
      }
    )
    return true
  }
}

const connector = new MacifContentScript()
connector
  .init({
    additionalExposedMethodsNames: [
      'checkInterceptions',
      'getIdentity',
      'getAttestations',
      'getPaymentSchedules',
      'checkDomainChange'
    ]
  })
  .catch(err => {
    log.warn(err)
  })
// This function comes with the determineForceFetchAll function, actually not in use.
// function getDateDistanceInDays(dateString) {
//   const distanceMs = Date.now() - new Date(dateString).getTime()
//   const days = 1000 * 60 * 60 * 24
//   return Math.floor(distanceMs / days)
// }
