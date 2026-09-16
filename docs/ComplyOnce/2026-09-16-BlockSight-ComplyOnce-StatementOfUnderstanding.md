---
title: "BlockSight / ComplyOnce Integration"
subtitle: "Statement of Understanding"
lang: en-US
plantuml-format: svg
---

# Scope

ComplyOnce provides identity, KYC, eligibility, X-Road and orchestration.

BlockSight provides wallet intelligence through its existing multi-tenant API.

BlockSight does not host or configure X-Road.

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

component "BlockSight API\n\nMulti-tenant\nMetered API\nWallet intelligence" as BS
database "ComplyOnce\nKYC Store" as KYC

Bank --> BankXR
BankXR --> COXR : X-Road
COXR --> CO

CO --> BS : HTTPS\nAPI key
CO --> KYC : KYC / ZK proof

@enduml
```

**Integration boundary:** Bank to X-Road to ComplyOnce to the BlockSight API.

KYC source data remains within ComplyOnce. BlockSight receives only the data required for wallet analysis.

## BlockSight Wallet Scoring

```plantuml
@startuml

title BlockSight API - New Wallet Scoring

autonumber

actor "ComplyOnce\nIntegration API" as Client
participant "BlockSight API" as API
participant "BlockSight\nScoring Pipeline" as Scoring

Client -> API: GET /v1/wallets/{chain}/{wallet}/intelligence\nAuthorization: Bearer <API key>

activate API
API -> Scoring: Start wallet indexing + scoring
API --> Client: 202 Accepted\njob_id\nestimated_ready_at
deactivate API

loop Poll until completed
    Client -> API: GET /v1/jobs/{job_id}
    API --> Client: 200 OK\nqueued / initializing / running
end

Scoring --> API: Scoring complete

Client -> API: GET /v1/jobs/{job_id}
API --> Client: 200 OK\ncompleted

Client -> API: GET /v1/wallets/{chain}/{wallet}/intelligence
API --> Client: 200 OK\nwallet intelligence

@enduml
```

New-wallet scoring is asynchronous. Expected initial processing time is **under 30 seconds**, subject to chain and provider conditions. The API contract exposes `estimated_ready_at`.

## End-to-End Flow

```plantuml
@startuml

title ComplyOnce / X-Road / BlockSight - End-to-End Flow

autonumber

actor "User" as User
participant "ComplyOnce\nIdentity / KYC" as Identity
participant "Bank / Consuming\nService" as Bank
participant "Bank X-Road\nSecurity Server" as BankXR
participant "ComplyOnce X-Road\nSecurity Server" as COXR
participant "ComplyOnce\nIntegration API" as COAPI
participant "BlockSight API" as BS

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

COAPI -> BS: GET wallet intelligence\nBearer: BlockSight API key
BS --> COAPI: 202 Accepted\njob_id\nestimated_ready_at

loop Poll until completed
    COAPI -> BS: GET /v1/jobs/{job_id}
    BS --> COAPI: 200 OK\nqueued / initializing / running
end

COAPI -> BS: GET wallet intelligence
BS --> COAPI: 200 OK\nwallet scores / risk / intelligence

== Decision ==

COAPI -> COAPI: Combine eligibility\n+ wallet intelligence
COAPI --> COXR: Decision / response
COXR --> BankXR: X-Road response
BankXR --> Bank: Result
Bank --> User: Allow / deny / review

@enduml
```

## Responsibilities

**ComplyOnce:** identity, KYC, ZK/eligibility, X-Road, orchestration and final policy decision.

**BlockSight:** wallet ingestion, scoring, risk intelligence, API authentication, tenant isolation and metering.

This document records the intended integration boundary, subject to confirmation by both teams.
