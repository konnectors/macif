import { ContentScript } from 'cozy-clisk/dist/contentscript'
import Minilog from '@cozy/minilog'
const log = Minilog('ContentScript')
Minilog.enable('macifCCC')

const baseUrl = 'https://www.macif.fr'

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
    await this.waitForElementInWorker('[pause]')
  }

  async ensureAuthenticated({ account }) {
    this.bridge.addEventListener('workerEvent', this.onWorkerEvent.bind(this))
    this.log('info', '🤖 ensureAuthenticated')
    if (!account) {
      await this.ensureNotAuthenticated()
    }
    await this.navigateToLoginForm()
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
    // logout
    return true
  }

  async checkAuthenticated() {
    this.log('info', '🤖 checkAuthenticated')
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
    return {
      sourceAccountIdentifier: 'defaultTemplateSourceAccountIdentifier'
    }
  }

  async fetch() {
    this.log('info', '🤖 fetch')
  }
}

const connector = new MacifContentScript()
connector.init({ additionalExposedMethodsNames: [] }).catch(err => {
  log.warn(err)
})
