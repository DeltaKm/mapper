export interface business {
    businessId: string
    name: string
    category: string[]
    products: string[]
    varvariants: string[]
    attributes: string[]
}



export interface dataList {
    ArticleNonte: string
    BillRow: number
    Cameriere: string
    CodCameriere: string
    CommPreparazione: string
    Code: string
    ConstoSepID: number
    ContoSepName: string
    DataAcquisizione: Date
    GroupCode: string
    GroupDescription: string
    IdentificativoPOS: string
    Name: string
    NSessioneComanda: string
    OrderIDGateway: string
    Peso: number
    Price: number
    Qta: number
    Subscriber: string
    Subscriber_Riforder: string
    Terminale: string
    TipoRec: string
}

// questa sembra la nuova registrazione anagrafica proveniente dal gateway
export interface customerList{
    idReferenceGateway: String
    idCustomer: string
    idCustomerExt: string
    idCustomerProduct: string
    gender: string
    name: string
    surname: string
    birth_data: string
    OrderWebInfo: OrderWebInfo // da verificare la coerenza
    vat_number: string
    residence_address: string
    residence_zipcode: string
    residence_city: string
    residence_province: string
    residence_state: string
    domicile_address: string
    domicile_zipcode: string
    domicile_city: string
    domicile_province: string
    domicile_state: string
    phone: string
    mobile: string
    telephone: string
    cellphone: string
    email: string
    publicCode: string
    subscriber: string
    arrived_from: string
    arrived_from_lastUpdate: string
    fidelity_card_number: string
    consent_marketing: string
    consent_third_parties_marketing: string
    dateCreation: string
    dateLastUpdate: string
    dateCreationProduct: string
    dateLastUpdateProduct: string
    deleted: string
}


interface OrderWebInfo {
    IDCustomer: String
    CustomersName: String
    Subscriber: String
    OrderIDUniqueSubscriber: String
    RifSubscriber: String
    email: String
    Telephone: String
}

/*
Standard MKT Access
*/

interface mktStandardAccess {
    id: string
    rif_app: string
    tokenJWT: string
    tokenValidation(token: string): string
}

export interface eosID {
    id: string
    app_rif: string
}

export interface customerListType {
    id: string
    idReferenceGateway: string
    idCustomer: string
    idCustomerExt: string
    idCustomerProduct: string
    gender: string
    name: string
    surname: string
    birth_data: string
    fiscal_code: string
    business: string
    vat_number: string
    residence_address: string
    residence_zipcode: string
    residence_city: string
    residence_province: string
    residence_region: string
    residence_state: string
    domicile_address: string
    domicile_zipcode: string
    domicile_city: string
    domicile_province: string
    domicile_region: string
    domicile_state: string
    phone: string
    mobile: string
    telephone: string
    cellphone: string
    email: string
    publicCode: string
    subscriber: string
    arrived_from: string
    arrived_from_lastUpdate: string
    fidelity_card_number: string
    consent_marketing: string
    consent_third_parties_marketing: string
    dateCreation: string
    dateLastUpdate: string
    dateCreationProduct: string
    dateLastUpdateProduct: string
    deleted: string
}

export class eosID {
    constructor(public idAPP: string, public idGateway: string, public appRif: string) {
        const idA = this.idAPP
        const idG = this.idGateway
        const appR = this.appRif
    }

    // method section
    connect(): any {
        let res
        return res
    }
    connection = this.connect()

    public store(
        idA: string = this.idAPP,
        idG: string = this.idGateway,
        appR: string = this.appRif,
    ): any {
        let res = this.connect()
        return res
    }

    public update(
        query: string
    ): any {
        let res
        return res
    }

    public patch(
        query: string
    ): any {
        let res
        return res
    }

    public get(
        query: string
    ): any {
        let res
        return res
    }

    public delete(
        query: string): any {
        let res
        return res
    }

    public log(
        query: string
    ): any {
        let res
        return res
    }
}


export class mktAccess implements mktStandardAccess {
    constructor(public id: string, public rif_app: string, public tokenJWT: string) {
        this.id = id
        this.rif_app = rif_app
        this.tokenJWT = tokenJWT
    }
    tokenp = this.tokenJWT
    tokenValidation(token: string): any {
        // logic val    
        return token;
    }

    res = this.tokenValidation(this.tokenp)
}

export class crossOriginAPP {
    constructor(public token: string) {
        const access = new mktAccess("name", "rifapp", this.token)
        this.token = token
    }
    setCrossOriginToken(token: string): any {
        if (token) return this.token
    }
}

// ========== test area ==========

const userID = "312854";
const rifAPP = "EasyAppear";
const token = "token";

const validation = new mktAccess(userID, rifAPP, token);

console.log(validation.tokenValidation("test token"));
console.log(validation.res)

// ========== test area ==========



// export default mktAccess;