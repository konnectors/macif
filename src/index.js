import { ContentScript } from 'cozy-clisk/dist/contentscript'
import Minilog from '@cozy/minilog'
import waitFor, { TimeoutError } from 'p-wait-for'
import { parse } from 'date-fns'
import FetchInterceptor from './fetchInterceptor'
const log = Minilog('ContentScript')
Minilog.enable('macifCCC')

const baseUrl = 'https://www.macif.fr'
const personnalInfosUrl = `${baseUrl}/assurance/particuliers/vos-espaces-macif/espace-assurance/infos-persos`
// let FORCE_FETCH_ALL = false

const fetchInterceptor = new FetchInterceptor()
fetchInterceptor.init()

class MacifContentScript extends ContentScript {
  onWorkerReady() {
    if (
      document.readyState === 'complete' ||
      document.readyState === 'loaded'
    ) {
      this.setListeners()
    } else {
      window.addEventListener('DOMContentLoaded', () => {
        this.setListeners()
      })
    }
  }

  onWorkerEvent({ event, payload }) {
    this.log('info', 'onWorkerEvent starts')
    if (event === 'loginSubmit') {
      this.log('info', 'received loginSubmit, blocking user interactions')
      this.blockWorkerInteractions()
      const { login, password } = payload || {}
      if (login && password) {
        // On this website you could use your adherent number or your mail.
        // We just follow de convention to save an "email"
        // into the keyChain so there is no confusion when manipulating this credentials later
        const email = login
        this.store.userCredentials = { email, password }
      }
    } else if (event === 'loginError') {
      this.log(
        'info',
        'received loginError, unblocking user interactions: ' + payload?.msg
      )
      this.unblockWorkerInteractions()
    }
  }

  setListeners() {
    this.log('debug', '📍️ setListeners starts')
    const form = document.querySelector('form')
    const loginError = document.querySelector('#error-login')
    if (form) {
      const passwordField = document.querySelector('#password')
      const submitButton = document.querySelector('button[onclick="postOk();"]')
      if (passwordField) {
        passwordField.addEventListener('keypress', event => {
          if (event === 'Enter') {
            this.log('info', 'Keyboard Enter - emitting credentials')
            const password = document.querySelector('#password')?.value
            const login = document.querySelector('#username')?.value
            if (password && login) {
              this.bridge.emit('workerEvent', {
                event: 'loginSubmit',
                payload: { login, password }
              })
            }
          }
        })
      }
      if (submitButton) {
        submitButton.addEventListener('click', () => {
          this.log('info', 'Button click - emitting credentials')
          const password = document.querySelector('#password')?.value
          const login = document.querySelector('#username')?.value
          if (password && login) {
            this.bridge.emit('workerEvent', {
              event: 'loginSubmit',
              payload: { login, password }
            })
          }
        })
      }
    }
    if (loginError) {
      this.bridge.emit('workerEvent', {
        event: 'loginError',
        payload: { msg: loginError.innerHTML }
      })
    }
  }

  async navigateToLoginForm() {
    this.log('info', '🤖 navigateToLoginForm')
    await this.goto(baseUrl)
    await Promise.all([
      // The li is mandatory,otherwise there is another element found with
      // this href but it's not corresping with the expected button
      this.waitForElementInWorker(
        'li > a[href="/assurance/particuliers/acceder-vos-espaces"]'
      ),
      this.waitForElementInWorker(
        'a[href="https://agence.macif.fr/assurance/"]'
      )
    ])
    await this.runInWorker(
      'click',
      'li > a[href="/assurance/particuliers/acceder-vos-espaces"]'
    )
    await this.runInWorkerUntilTrue({
      method: 'checkAndWaitForLoginPageDetection'
    })
  }

  async ensureAuthenticated({ account }) {
    this.bridge.addEventListener('workerEvent', this.onWorkerEvent.bind(this))
    this.log('info', '🤖 ensureAuthenticated')
    if (!account) {
      await this.ensureNotAuthenticated()
    }
    if (!(await this.isElementInWorker('#login'))) {
      await this.navigateToLoginForm()
    }
    const authenticated = await this.runInWorker('checkAuthenticated')
    if (!authenticated) {
      this.log('info', 'Not authenticated')
      const credentials = await this.getCredentials()
      if (credentials) {
        try {
          // Full autoLogin is not possible on this website, there's a 2FA for each connection
          // So we're only prefilling and sending the form to reach the 2FA page.
          await this.prefillAndSendLoginForm(credentials)
          this.log('info', 'Prefill successful, waiting for 2FA ...')
        } catch {
          this.log(
            'info',
            'Something went wrong with autoLogin, letting user log in'
          )
          await this.showLoginFormAndWaitForAuthentication()
        }
      } else {
        await this.showLoginFormAndWaitForAuthentication()
      }
    }
    if (
      (await this.isElementInWorker('.auth-factor')) ||
      (await this.isElementInWorker('#passcode'))
    ) {
      this.log('info', 'Waiting for 2FA ...')
      this.unblockWorkerInteractions()
      await this.show2FAFormAndWaitForInput()
    }
    if (
      await this.isElementInWorker('a[href="/espace-client?fromMire=true"]', {
        includesText: 'Continuer vers mon espace'
      })
    ) {
      this.log('info', 'StayConnectedButton found')
      await this.clickAndWait(
        'a[href="/espace-client?fromMire=true"]',
        '.icon-deconnexion'
      )
    }
    this.unblockWorkerInteractions()
    return true
  }

  async ensureNotAuthenticated() {
    this.log('info', '🤖 ensureNotAuthenticated')
    await this.navigateToLoginForm()
    const authenticated = await this.runInWorker('checkAuthenticated')
    if (!authenticated) {
      this.log('info', 'User is not authenticated')
      return true
    }
    this.log('info', 'User is authenticated')
    this.log(
      'debug',
      `this.store.stayConnected : ${JSON.stringify(this.store.stayConnected)}`
    )
    if (this.store.stayConnected) {
      await this.clickAndWait(
        '[href="/espace-client?fromMire=true"]',
        '.icon-deconnexion'
      )
    }
    if (await this.isElementInWorker('#profil-avatar')) {
      // For certain accounts, the profil button "#profil-avatar" doesn't exist.
      // If so, the logout button is outside of the webview (you litteraly cannot see it or reach it to click it)
      // but it exist in the HTML. Once clicked, the path is the same.
      this.log('debug', 'Avatar condition')
      await this.clickAndWait('#profil-avatar', 'button[data-logout]')
      await this.clickAndWait(
        'button[data-logout]',
        'button[data-ng-click="logout()"]'
      )
      await this.runInWorker('click', 'button[data-ng-click="logout()"]')
      this.log('debug', 'supposed to click final logout button')
    } else {
      this.log('debug', 'Empty accounts condition')
      await this.runInWorker('click', 'button', {
        includesText: 'Déconnexion'
      })
      await this.waitForElementInWorker('button', {
        includesText: 'Se déconnecter'
      })
      this.log('debug', 'supposed to click final logout button')
      await this.runInWorker('click', 'button', {
        includesText: 'Se déconnecter'
      })
    }
    await this.waitForElementInWorker('.mcf-navbar__nav')
    this.log('debug', 'supposed to have reach main page')
    return true
  }

  async checkAuthenticated() {
    this.log('info', '🤖 checkAuthenticated')
    const stayConnectedButton = document.querySelector(
      '[href="/espace-client?fromMire=true"]'
    )
    const twoFAType = document.querySelector('.auth-factor')
    const twoFAInputs = document.querySelector('#passcode')
    if (twoFAType || twoFAInputs) {
      this.log('info', 'Login OK - 2FA needed, wait for user action')
      return true
    }
    if (
      stayConnectedButton &&
      stayConnectedButton.textContent === 'Continuer vers mon espace'
    ) {
      this.log('info', 'stayConnected button detected')
      return true
    }
    return Boolean(
      document.querySelector('.icon-deconnexion') ||
        document.querySelector('#rattacher-contrats')
    )
  }

  async showLoginFormAndWaitForAuthentication() {
    this.log('info', '🤖 showLoginFormAndWaitForAuthentication start')
    await this.setWorkerState({ visible: true })
    await this.runInWorkerUntilTrue({
      method: 'waitForAuthenticated'
    })
    await this.setWorkerState({ visible: false })
  }

  async prefillAndSendLoginForm(credentials) {
    this.log('info', '📍️ prefillAndSendLoginForm starts')
    const emailInputSelector = '#login'
    const passwordInputSelector = '#password'
    const emailNextButtonSelector = 'button[name="submitButton"]'
    const passwordSubmitButtonSelector = 'button[onclick="postOk();"]'
    await this.waitForElementInWorker(emailInputSelector)
    const foundLogin = await this.evaluateInWorker(function getLoginValue() {
      return document.querySelector('#login')?.value
    })
    if (foundLogin === credentials.email) {
      this.log('debug', 'Website remember user, continue to password')
      await this.runInWorker('click', emailNextButtonSelector)
    } else {
      this.log('debug', 'Fill email field')
      await this.runInWorker('fillText', emailInputSelector, credentials.email)
      await this.runInWorker('click', emailNextButtonSelector)
    }

    this.log('debug', 'Wait for password field')
    await this.waitForElementInWorker(passwordSubmitButtonSelector)
    this.log('debug', 'Fill password field')
    await this.runInWorker(
      'fillText',
      passwordInputSelector,
      credentials.password
    )
    await this.runInWorker('click', passwordSubmitButtonSelector)
    await this.Promise.race([
      // Next line to remove when finish
      this.waitForElementInWorker('#rattacher-contrats'),
      this.waitForElementInWorker('button[data-logout]'),
      this.waitForElementInWorker('#passcode'),
      this.waitForElementInWorker('.auth-factor')
    ])
  }

  async show2FAFormAndWaitForInput() {
    log.debug('show2FAFormAndWaitForInput start')
    await this.setWorkerState({ visible: true })
    await this.runInWorkerUntilTrue({ method: 'waitFor2FA' })
    await this.setWorkerState({ visible: false })
  }

  async waitFor2FA() {
    this.log('info', 'waitFor2FA starts')
    await waitFor(
      () => {
        if (
          document.querySelector('button[data-logout]') ||
          document.querySelector('#rattacher-contrats')
        ) {
          this.log('info', '2FA OK - Land on home')
          return true
        }
        return false
      },
      {
        interval: 1000,
        timeout: Infinity
      }
    )
    return true
  }

  async getUserDataFromWebsite() {
    this.log('info', '🤖 getUserDataFromWebsite')
    if (
      !(await this.isElementInWorker(
        'a[href="/assurance/particuliers/vos-espaces-macif/espace-assurance/infos-persos"]'
      ))
    ) {
      // With the created testAccount for the development, there is nothing to fetch at all
      // No identity, no files whatsoever. Meaning that if the user just created his account and tries
      // to launch the konnector, It would have failed on the next click.
      // As there is no way of finish the execution successfully in this case, a clear error is needed.
      throw new Error(
        '❌️ This account has nothing to fetch, aborting execution'
      )
    }

    // Force sourceAccountIdentifier to be what's user inputs as credentials
    const savedCredentials = await this.getCredentials()
    const sourceAccountIdentifier =
      this.store?.userCredentials?.email || savedCredentials?.email
    if (sourceAccountIdentifier) {
      return { sourceAccountIdentifier }
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
    await this.goto(personnalInfosUrl)
    await this.waitForElementInWorker(
      'a[href="/assurance/particuliers/vos-espaces-macif/espace-assurance/infos-persos/modifier-email"]'
    )
    await this.runInWorkerUntilTrue({
      method: 'checkInterceptions',
      args: ['personnalInfos']
    })
    await this.runInWorker('getIdentity')
    if (this.store.userIdentity) {
      this.log('info', 'Saving identity ...')
      await this.saveIdentity({ contact: this.store.userIdentity })
    }
  }

  async checkInterceptions(option) {
    this.log('info', `📍️ checkInterceptions for ${option} starts`)
    await waitFor(
      () => {
        if (option === 'personnalInfos') {
          return Boolean(
            fetchInterceptor.personnalInfos.length > 0 &&
              fetchInterceptor.personIdentity.length > 0
          )
        }
        if (option === 'attestations') {
          return Boolean(fetchInterceptor.attestationsInfos.length > 0)
        }
        if (option === 'schedules') {
          return Boolean(fetchInterceptor.schedulesInfos.length > 0)
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
    const infos = fetchInterceptor.personnalInfos[0].data
    const identity = fetchInterceptor.personIdentity[0].data
    const userIdentity = {
      email: infos.compte.email.znAdrEmail,
      name: {
        givenName: identity.znPrenPers,
        familyName: identity.nmPers
      },
      address: this.getAddresses(infos.macif.adresses),
      phone: this.getPhones(infos.macif.telephones)
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

  async checkAndWaitForLoginPageDetection() {
    this.log('info', '📍️ checkAndWaitForLoginPageDetection starts')
    await waitFor(
      async () => {
        const sumbitButton = document.querySelector('[id=":r1:"]')
        const stayConnectedButton = document.querySelector(
          '[href="/espace-client?fromMire=true"]'
        )
        if (sumbitButton) {
          // Changes on the website now allows user to use a "stayConnected" button
          // But every tries, the login input is displayed to the user for a brief moment before it detects user's active session and modifies the page
          // Leading the Promise.race to resolve earlier than expected and the checkAuthenticated method to detect a false positive
          // If this attributes is true, it means the website is loading the session so we're not really on the login step
          const isDisabled = sumbitButton.getAttribute('aria-disabled')
          // Returning value is a string "true"/"false", condition on an expected boolean wont work
          if (isDisabled === 'true') {
            this.log(
              'info',
              'loginPage sumbit button detected but disabled, checking stayConnected button'
            )
          } else {
            this.log(
              'info',
              'loginPage sumbit button is enabled, first loginStep'
            )
            return true
          }
        }
        if (
          stayConnectedButton &&
          stayConnectedButton.textContent === 'Continuer vers mon espace'
        ) {
          this.log('info', 'stayConnected button detected')
          await this.sendToPilot({ stayConnected: true })
          return true
        }
        return false
      },
      {
        interval: 1000,
        timeout: 30 * 1000
      }
    )
    return true
  }

  async getAttestations() {
    this.log('info', '📍️ getAttestations starts')
    const allAttestationsInfos = fetchInterceptor.attestationsInfos[0].data
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
      'waitFor2FA',
      'checkInterceptions',
      'getIdentity',
      'getAttestations',
      'getPaymentSchedules',
      'checkDomainChange',
      'checkAndWaitForLoginPageDetection'
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
