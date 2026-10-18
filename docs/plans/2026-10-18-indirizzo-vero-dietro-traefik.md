# Seme — l'indirizzo vero dei visitatori del cloud, dietro Traefik

> **Seme — decisione.** Quando questo lavoro comincia, il primo passo è **una sessione di plan approfondita**,
> dedicata, per sviscerarne tutti i dettagli. Qui c'è solo l'idea e quello che si è misurato oggi.

## L'idea

Il gateway del cloud non sa chi lo chiama: Traefik vede **ogni** visitatore con lo stesso indirizzo, quello
interno di rootlessport. I limiti per indirizzo (`sws-web/src/limiti.rs`, onda 2, C6) per questo sul gateway
**non contano** gli indirizzi privati: oggi il cloud non ha limiti. Lo stesso indirizzo finto finisce in ogni
`X-Forwarded-For`, quindi anche nei log.

## Cosa si è misurato (18-10-2026)

- VPS: podman **rootless**, rete `netavark`, `pasta` presente. Traefik (`systemd-traefik`) pubblica `80` e `443`
  con `PublishPort` sulla rete `sws-rete`.
- Nell'access log di Traefik, in due minuti, 1.238 richieste su 1.238 vengono da `10.89.0.89`, mentre il client
  vero aveva `93.34.228.246`.
- Il gateway vede Traefik da un indirizzo privato della stessa rete e prende l'**ultimo** elemento di
  `X-Forwarded-For`, che oggi è sempre `10.89.0.89`.

## Strade già visibili (da valutare, non decise)

1. Traefik con la rete `pasta` invece della rete bridge per le porte pubblicate: pasta conserva l'indirizzo
   d'origine, ma Traefik deve poi raggiungere il gateway sulla rete `sws-rete`.
2. Il gestore delle porte di rootless (`rootless_port_handler`, `Network=…:port_handler=slirp4netns`), che conserva
   l'indirizzo.
3. Traefik a livello di sistema, non rootless, solo per lui.
4. Il PROXY protocol fra un ingresso che vede l'indirizzo vero e Traefik.

Quando l'indirizzo arriva, si toglie la regola «privato = non si conta» dal gateway e si rimette la prova col banco
dietro il cloud.
