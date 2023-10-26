import { ContentScript } from 'cozy-clisk/dist/contentscript'
import Minilog from '@cozy/minilog'
import waitFor, { TimeoutError } from 'p-wait-for'
const log = Minilog('ContentScript')
Minilog.enable('macifCCC')

const baseUrl = 'https://www.macif.fr'

const personnalInfos = []
const personIdentity = []
const attestationsInfos = []
const billsInfos = []

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

  async fetch() {
    this.log('info', '🤖 fetch')
    if (this.store.userCredentials) {
      this.log('info', 'Saving credentials ...')
      await this.saveCredentials(this.store.userCredentials)
    }
    if (this.store.userIdentity) {
      this.log('info', 'Saving identity ...')
      await this.saveIdentity({ contact: this.store.userIdentity })
    }
    await this.waitForElementInWorker('[pause]')
  }

  async checkInterceptions(option) {
    this.log('info', `📍️ checkInterceptions for ${option} starts`)
    await waitFor(
      () => {
        if (option === 'personnalInfos') {
          return Boolean(personnalInfos.length > 0 && personIdentity.length > 0)
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
    this.log(
      'info',
      `getIdentity - userIdentity : ${JSON.stringify(userIdentity)}`
    )
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
}

const connector = new MacifContentScript()
connector
  .init({
    additionalExposedMethodsNames: ['checkInterceptions', 'getIdentity']
  })
  .catch(err => {
    log.warn(err)
  })
