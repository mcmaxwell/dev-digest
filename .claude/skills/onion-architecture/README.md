# onion-architecture — sources

Rules in `SKILL.md` and `references/` are distilled from these sources,
adapted to this repo's existing conventions (hand-rolled DI container,
module layout, vendored shared contracts).

## Onion / layered architecture canon

- [The Onion Architecture: part 1 — Jeffrey Palermo (2008, origin of the term)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)
- [Onion Architecture — Herberto Graça, The Software Architecture Chronicles](https://herbertograca.com/2017/09/21/onion-architecture/)
- [Clean Node.js Architecture — Khalil Stemmler (Clean vs Onion vs Hexagonal vs Layered, for TypeScript)](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-nodejs-architecture/)
- [Implementing SOLID and the onion architecture in Node.js with TypeScript — Remo H. Jansen](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad)
- [Onion Architecture in Node.js with TypeScript — Sankhadip Samanta](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391)

## Ports & adapters, dependency injection

- [Hexagonal Architecture (Ports & Adapters): Clean Boundaries — Chanh Le](https://chanhle.dev/en/blog/hexagonal-architecture-ports-adapters)
- [Hexagonal Architecture: A Complete Guide with a TypeScript Example — Generalist Programmer](https://generalistprogrammer.com/tutorials/hexagonal-architecture-complete-guide)
- [Dependency Inversion & Ports/Adapters — Synapse Studios Engineering Standards](https://docs.synapsestudios.com/concepts/architecture/dependency-inversion.html)
- [fastify-awilix — official Fastify DI plugin](https://github.com/fastify/fastify-awilix)
  (reference only: this project deliberately keeps a hand-rolled container —
  see `references/di-ports-adapters.md`)

## Persistence / repository pattern

- [Drizzle ORM Best Practices — Paul Serban](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/)
- [Repository Pattern in Nest.js with Drizzle ORM — vimulatus](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae)
- [Atomic Repositories in Clean Architecture and TypeScript — Sentry Engineering](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/)
- [Transactions with DDD and Repository Pattern in TypeScript, part 2 — João Batista da Silva](https://medium.com/@joaojbs199/transactions-with-ddd-and-repository-pattern-in-typescript-a-guide-to-good-implementation-part-2-da0af3e10901)
- [The Repository Pattern — Muyiwa](https://muyiwa-dev.medium.com/the-repository-pattern-ff87cde360ce)

## Validation at boundaries

- [Parse, don't validate, incoming data in TypeScript — Elias Nygren](https://itnext.io/parse-dont-validate-incoming-data-in-typescript-d6d5bfb092c8)
- [TypeScript vs Zod: clearing up validation confusion — LogRocket](https://blog.logrocket.com/when-use-zod-typescript-both-developers-guide/)
