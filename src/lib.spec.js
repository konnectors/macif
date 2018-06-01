// jest.mock('cozy-konnector-libs')

// const cklibs = require('cozy-konnector-libs')

// cklibs.log.mockImplementation(() => {
//   return jest.mock()
// })

const lib = require('./lib')

const insuranceCertificatesPayload = {
  data: {
    eligibiliteAttestations: [
      {
        znNmAttestation: 'Attestation Assistance aux personnes',
        cdGroupeAttestation: 'G7',
        contratEligibiliteAttestations: [
          {
            noOrdreContrat: 1,
            noInt: 1,
            cdProdAssu: 'R',
            cdObjAssu: 'RFA',
            cdResilCont: '',
            personneBeneficiaireEligibiliteAttestations: []
          }
        ]
      },
      {
        znNmAttestation: 'Attestation Scolaire',
        cdGroupeAttestation: 'G1',
        contratEligibiliteAttestations: [
          {
            noOrdreContrat: 1,
            noInt: 1,
            cdProdAssu: 'M',
            cdObjAssu: 'MCF',
            cdResilCont: '',
            personneBeneficiaireEligibiliteAttestations: []
          }
        ]
      },
      {
        znNmAttestation: 'Attestation Ski',
        cdGroupeAttestation: 'G8',
        contratEligibiliteAttestations: [
          {
            noOrdreContrat: 1,
            noInt: 1,
            cdProdAssu: 'M',
            cdObjAssu: 'MCF',
            cdResilCont: '',
            personneBeneficiaireEligibiliteAttestations: []
          }
        ]
      },
      {
        znNmAttestation: 'Attestation Assistante maternelle',
        cdGroupeAttestation: 'G9',
        contratEligibiliteAttestations: [
          {
            noOrdreContrat: 1,
            noInt: 1,
            cdProdAssu: 'M',
            cdObjAssu: 'MCF',
            cdResilCont: '',
            personneBeneficiaireEligibiliteAttestations: []
          }
        ]
      },
      {
        znNmAttestation: 'Attestation Location de Vacances',
        cdGroupeAttestation: 'G3',
        contratEligibiliteAttestations: [
          {
            noOrdreContrat: 1,
            noInt: 1,
            cdProdAssu: 'M',
            cdObjAssu: 'MCF',
            cdResilCont: '',
            personneBeneficiaireEligibiliteAttestations: []
          }
        ]
      }
    ]
  }
}

const paymentNoticesPayload = {
  data: [
    {
      dtAvisEcheance: '2018-04-01T14:18:42.268',
      znRefPublicDocElec: '3_12876111_2018_EP',
      semestre: 'EP',
      znAnnee: 2018
    }
  ]
}

// beforeEach(() => {
//   lib.downloadFile = url => {
//     return 'downloadFile ' + url
//   }
// })

describe('parsing', () => {
  it('should correctly parse insurance certificates', () => {
    lib.parseInsuranceCertificates(insuranceCertificatesPayload)
  })

  it('should correctly parse payment notices', () => {
    paymentNoticesPayload
  })
})
