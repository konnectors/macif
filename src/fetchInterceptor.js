export default class FetchInterceptor {
  constructor() {
    this.attestationsInfos = []
    this.schedulesInfos = []
  }
  init() {
    const self = this
    const fetchOriginal = window.fetch
    window.fetch = async (...args) => {
      const response = await fetchOriginal(...args)
      if (
        args[0].url &&
        args[0].url ===
          'https://ssm.macif.fr/internet-contrat-rest/v2/attestations'
      ) {
        await response
          .clone()
          .json()
          .then(body => {
            self.attestationsInfos.push(body)
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
            self.schedulesInfos.push(body)
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
  }
}
