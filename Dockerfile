FROM evoapicloud/evolution-api:v2.3.7

ENV SERVER_PORT=8080
ENV SERVER_TYPE=http
ENV AUTHENTICATION_API_KEY=LoucuraDeOfertasSecretKey2026
ENV DATABASE_ENABLED=false
ENV QRCODE_LIMIT=30

EXPOSE 8080

# Pula o script de migrations obrigatórias de PostgreSQL e inicia o servidor diretamente
ENTRYPOINT ["/bin/bash", "-c", "npm run start:prod"]
