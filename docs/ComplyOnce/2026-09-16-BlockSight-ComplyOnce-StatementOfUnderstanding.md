---
title: "BlockSight / ComplyOnce Integration"
subtitle: "Statement of Understanding"
lang: en-US
plantuml-format: svg
style: technical
---

# Scope

ComplyOnce owns and operates the identity, KYC, eligibility, X-Road, and orchestration layers, including configuration and operation of its X-Road Security Server.

BlockSight provides wallet intelligence through its existing multi-tenant, metered API.

BlockSight does not host, configure, or participate directly in X-Road. BlockSight is not an X-Road member or subsystem in this integration. ComplyOnce consumes the BlockSight API as a downstream service using a BlockSight-issued server-side credential.

## System Architecture

```plantuml
@startuml

top to bottom direction

skinparam componentStyle rectangle
skinparam shadowing false
skinparam nodesep 40
skinparam ranksep 30
skinparam defaultTextAlignment center

actor "Bank" as Bank

component "Bank X-Road\nSecurity Server" as BankXR
component "ComplyOnce X-Road\nSecurity Server" as COXR
component "ComplyOnce\nIntegration API" as CO
component "ComplyOnce Identity\n& Eligibility Service" as Identity

component "BlockSight API\n\nMulti-tenant\nMetered API\nWallet intelligence" as BS
database "ComplyOnce\nKYC Store" as KYC

Bank --> BankXR
BankXR --> COXR : X-Road
COXR --> CO

CO --> Identity : Eligibility check
Identity --> KYC : KYC / proof verification
CO --> BS : HTTPS\nBearer: BlockSight API key

@enduml
```

**Integration boundary:** Bank backend to X-Road to ComplyOnce to the BlockSight API.

ComplyOnce is the BlockSight API consumer and tenant for this integration. BlockSight authentication and usage metering are performed against the ComplyOnce credential unless a separate per-bank tenancy model is agreed. Downstream banks are not BlockSight tenants and do not receive BlockSight credentials under this model.

KYC source data and zero-knowledge proof verification remain within ComplyOnce. BlockSight receives only the wallet and request context required for wallet intelligence and does not receive or verify underlying KYC evidence, zero-knowledge proofs, or witness material. ComplyOnce converts its identity and eligibility results into the final policy decision.

## BlockSight Wallet Scoring

```plantuml
@startuml

title BlockSight API - New Wallet Scoring

autonumber

actor "ComplyOnce\nIntegration API" as Client
participant "BlockSight API" as API
participant "BlockSight\nScoring Pipeline" as Scoring

Client -> API: GET /v1/wallets/{chain}/{wallet_address}/intelligence\nAuthorization: Bearer <BlockSight API key>

activate API
API -> Scoring: Start wallet indexing + scoring
API --> Client: 202 Accepted\njob_id\nestimated_ready_at
deactivate API

loop Poll while non-terminal
    Client -> API: GET /v1/jobs/{job_id}
    API --> Client: 200 OK\nqueued / initializing / running
end

Scoring --> API: completed / failed / expired

Client -> API: GET /v1/jobs/{job_id}
alt completed
    API --> Client: 200 OK\ncompleted
    Client -> API: GET /v1/wallets/{chain}/{wallet_address}/intelligence
    API --> Client: 200 OK\nwallet intelligence
else failed or expired
    API --> Client: 200 OK\nfailed / expired\nerror details
end

@enduml
```

For an already indexed wallet, BlockSight may return wallet intelligence immediately with `200 OK`. If indexing is required, BlockSight returns `202 Accepted` with a `job_id` and `estimated_ready_at`, and ComplyOnce polls the job until it reaches a terminal state: `completed`, `failed`, or `expired`. Wallet intelligence is retrieved after successful completion; ComplyOnce handles `failed` or `expired` as terminal failures.

The target initial processing time for a newly indexed wallet is **under 30 seconds**. Actual completion time may vary by chain and upstream provider conditions; `estimated_ready_at` is the API-provided estimate and is not an SLA commitment.

## End-to-End Flow

```plantuml
@startuml

title ComplyOnce / X-Road / BlockSight - End-to-End Flow

autonumber

actor "User" as User
participant "CO Identity" as Identity
participant "Bank Backend" as Bank
participant "Bank XR" as BankXR
participant "CO XR" as COXR
participant "CO API" as COAPI
participant "BlockSight" as BS

== Identity and eligibility ==

User -> Identity: Login with ComplyOnce
Identity -> Identity: Verify identity / KYC
Identity -> Identity: Establish ZK eligibility

== Bank request ==

User -> Bank: Request restricted operation
Bank -> BankXR: Submit service request
BankXR -> COXR: X-Road request
COXR -> COAPI: Forward authenticated request

COAPI -> Identity: Check eligibility
Identity --> COAPI: Eligibility satisfied

== Wallet intelligence ==

COAPI -> BS: GET /v1/wallets/{chain}/{wallet_address}/intelligence\nAuthorization: Bearer <BlockSight API key>
alt Already indexed
    BS --> COAPI: 200 OK\nwallet intelligence
else Indexing required
    BS --> COAPI: 202 Accepted\njob_id\nestimated_ready_at
    loop Poll until terminal state
        COAPI -> BS: GET /v1/jobs/{job_id}
        BS --> COAPI: queued / initializing / running\ncompleted / failed / expired
    end
    alt completed
        COAPI -> BS: GET wallet intelligence
        BS --> COAPI: 200 OK\nwallet intelligence
    else failed or expired
        COAPI -> COAPI: Handle terminal failure
    end
end

== Decision ==

COAPI -> COAPI: Combine eligibility\n+ wallet intelligence
COAPI --> COXR: Decision / response
COXR --> BankXR: X-Road response
BankXR --> Bank: Result
Bank --> User: Allow / deny / review

@enduml
```

## Responsibilities

**ComplyOnce:** end-user authentication, KYC data, zero-knowledge proof verification, eligibility, X-Road infrastructure and configuration, BlockSight orchestration, and final authorization and policy decisions.

**BlockSight:** wallet ingestion, behavioral and risk intelligence, scoring, API authentication, tenant isolation, and usage metering.

BlockSight supplies intelligence to ComplyOnce; it does not make the end-user authorization decision.

**Tenant model to confirm:** one ComplyOnce BlockSight tenant and credential, or separately agreed per-bank tenancy and metering.
