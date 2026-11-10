# Builds Hype (https://github.com/omacom/hype) from source, pinned to a commit,
# so HypeSlides can compare its rendering against the original.
FROM archlinux:base-devel-20261108.0.623074

RUN pacman -Syu --noconfirm --needed \
      qt6-base qt6-declarative qt6-multimedia qt6-imageformats qt6-svg \
      ffmpeg source-highlight zlib libwebp \
      gcc make git fontconfig ttf-jetbrains-mono \
    && pacman -Scc --noconfirm \
    && fc-cache -f

ARG HYPE_COMMIT=278d9805769c61286bd8246dd9b71da475c01ec9
RUN git clone https://github.com/omacom/hype.git /src/hype \
    && cd /src/hype && git checkout "$HYPE_COMMIT" \
    && ./bin/build \
    && install -Dm755 build/hype /usr/local/bin/hype \
    && echo "$HYPE_COMMIT" > /hype-commit \
    && cd / && rm -rf /src/hype

# Omarchy themes, so `theme: <name>` resolves as it does for real Hype users.
ARG OMARCHY_COMMIT=df3d01ce8240ebd6795621987dbb602420980dd0
RUN git clone https://github.com/basecamp/omarchy.git /tmp/omarchy \
    && cd /tmp/omarchy && git checkout "$OMARCHY_COMMIT" \
    && mkdir -p /opt/omarchy && cp -R themes /opt/omarchy/themes \
    && echo "$OMARCHY_COMMIT" > /omarchy-commit \
    && rm -rf /tmp/omarchy

ENV OMARCHY_PATH=/opt/omarchy \
    QT_QPA_PLATFORM=offscreen \
    QT_QPA_PLATFORMTHEME=generic \
    QT_STYLE_OVERRIDE=Fusion \
    HOME=/tmp

WORKDIR /work
ENTRYPOINT ["hype"]
