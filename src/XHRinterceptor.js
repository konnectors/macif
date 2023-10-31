export default class XHRInterceptor {
  constructor() {
    this.personnalInfos = []
    this.personIdentity = []
  }
  init() {
    const self = this
    var openProxied = window.XMLHttpRequest.prototype.open
    window.XMLHttpRequest.prototype.open = function () {
      var originalResponse = this
      if (arguments[1].includes('/espace-client/contacts/macif')) {
        originalResponse.addEventListener('readystatechange', function () {
          if (originalResponse.readyState === 4) {
            const jsonInfos = JSON.parse(originalResponse.responseText)
            self.personnalInfos.push(jsonInfos)
          }
        })
        return openProxied.apply(this, [].slice.call(arguments))
      }
      if (arguments[1].match(/\/internet-personne-rest\/personnes\/\d+/g)) {
        originalResponse.addEventListener('readystatechange', function () {
          if (originalResponse.readyState === 4) {
            const jsonInfos = JSON.parse(originalResponse.responseText)
            self.personIdentity.push(jsonInfos)
          }
        })
        return openProxied.apply(this, [].slice.call(arguments))
      }
      return openProxied.apply(this, [].slice.call(arguments))
    }
  }
}
