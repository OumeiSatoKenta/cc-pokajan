#!/bin/bash
set -e

# cc-pokajan はブラウザ完結のフロントエンドのみのプロジェクトのため、
# テンプレートに含まれる AWS / IaC 系ツール（aws-vault・SSM プラグイン・CDK・
# Terraform・tflint・Terragrunt）と deploy-on-aws プラグインは導入していない。
# 将来クラウドへデプロイする段になったら、scaffold のテンプレートから復活させること。

# PulseAudio client (for voice input from macOS host)
echo "[1/5] Installing PulseAudio client..."
sudo apt-get update -qq && sudo apt-get install -y -qq pulseaudio-utils libsox-fmt-pulse libasound2-plugins unzip
cat <<'ASOUNDRC' > "$HOME/.asoundrc"
pcm.!default {
    type pulse
}
ctl.!default {
    type pulse
}
ASOUNDRC
echo "[1/5] PulseAudio client installed."

# Claude Code
echo "[2/5] Installing Claude Code..."
curl -fsSL https://claude.ai/install.sh | bash
echo "[2/5] Claude Code installed."

# skill-creator plugin (Anthropic official / claude-plugins-official)
echo "[3/5] Installing skill-creator plugin..."
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install skill-creator@claude-plugins-official --scope user
echo "[3/5] skill-creator plugin installed."

# uv (Python package manager)
echo "[4/5] Installing uv (Python package manager)..."
curl -LsSf https://astral.sh/uv/install.sh | sh
sudo ln -sf "$HOME/.local/bin/uv" /usr/local/bin/uv
sudo ln -sf "$HOME/.local/bin/uvx" /usr/local/bin/uvx
echo "[4/5] uv installed."

# Draw.io MCP
echo "[5/5] Installing Draw.io MCP..."
npm i -g @drawio/mcp
echo "[5/5] Draw.io MCP installed."

# Shell aliases
grep -qxF "alias c='claude'" "$HOME/.bashrc" || echo "alias c='claude'" >> "$HOME/.bashrc"

echo "All tools installed successfully."

echo ""
echo "=== Installed versions ==="
echo "Claude Code: $(claude --version 2>&1 || echo 'not found')"
echo "Node:        $(node --version 2>&1 || echo 'not found')"
echo "npm:         $(npm --version 2>&1 || echo 'not found')"
echo "uv:          $(uv --version 2>&1 || echo 'not found')"
echo "Draw.io MCP: $(npm ls -g @drawio/mcp --depth=0 2>/dev/null | grep @drawio/mcp || echo 'installed')"
echo "Docker CLI:  $(docker --version 2>&1 || echo 'not found')"
echo "=========================="
