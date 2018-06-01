const {
  BaseKonnector,
  saveFiles,
  saveBills,
  log
} = require('cozy-konnector-libs')
const lib = require('./lib')
const parse = require('date-fns').parse

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  const paymentNotices = await fetchPaymentNotices()
  const insuranceCertificates = await fetchInsuranceCertificates()
  const payments = await fetchPayments()
  await saveBills(payments, fields, {
    identifiers: ['MACIF']
  })
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
  await lib.setupCookies()

  log('info', 'Logging in...')
  await lib.login(login, password)
}

async function fetchPaymentNotices() {
  const res = JSON.parse(await lib.fetchPaymentNotices())
  return lib.parsePaymentNotices(res)
}

async function fetchInsuranceCertificates() {
  const res = JSON.parse(await lib.fetchInsuranceCertificates())
  return lib.parseInsuranceCertificates(res)
}

const parseDate = x => {
  return parse(x, 'YYYY-MM-DD')
}

async function fetchPayments() {
  const res = JSON.parse(await lib.fetchPayments())
  const payments = res.data.evenementComptables
  return payments.map(x => ({
    date: parseDate(x.dtEvenCompta),
    amount: x.mtEvenCompta,
    vendor: 'MACIF',
    currency: '€',
    type: 'insurance'
  }))
}
