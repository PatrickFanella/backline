FROM scratch
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.source="https://git.subcult.tv/subculture-collective/backline"
COPY .ci-runtime-patch/ /payload/
