#!/bin/bash
set -euo pipefail

# ============================================================
# init-project.sh
# プロジェクト名・パスを一括置換する初期設定スクリプト
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- 現在のプロジェクト名を自動検出 ---
if [ -f "$PROJECT_ROOT/.devcontainer/devcontainer.json" ]; then
  CURRENT_NAME=$(grep -m1 '"name"' "$PROJECT_ROOT/.devcontainer/devcontainer.json" | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
else
  CURRENT_NAME="cc_base"
fi

if [ -z "$CURRENT_NAME" ]; then
  echo "エラー: 現在のプロジェクト名を検出できませんでした。" >&2
  exit 1
fi

# --- 引数 or 対話入力でプロジェクト名を取得 ---
if [ $# -ge 1 ]; then
  NEW_NAME="$1"
else
  read -rp "新しいプロジェクト名を入力してください (例: my_app): " NEW_NAME
fi

# --- バリデーション ---
if [ -z "$NEW_NAME" ]; then
  echo "エラー: プロジェクト名が空です。" >&2
  exit 1
fi

if [[ ! "$NEW_NAME" =~ ^[a-zA-Z][a-zA-Z0-9_-]*$ ]]; then
  echo "エラー: プロジェクト名は英字で始まり、英数字・ハイフン・アンダースコアのみ使用できます。" >&2
  exit 1
fi

if [ "$NEW_NAME" = "$CURRENT_NAME" ]; then
  echo "プロジェクト名が変更されていません。処理をスキップします。"
  exit 0
fi

echo "=========================================="
echo "プロジェクト初期設定"
echo "=========================================="
echo "  現在の名前: $CURRENT_NAME"
echo "  新しい名前: $NEW_NAME"
echo "  プロジェクト: $PROJECT_ROOT"
echo "=========================================="
echo ""

# --- 置換対象ファイルの一覧 ---
TARGET_FILES=(
  ".devcontainer/devcontainer.json"
  ".mcp.json"
  "docs/SETUP.md"
)

# --- 置換実行 ---
CHANGED=0
for file in "${TARGET_FILES[@]}"; do
  filepath="$PROJECT_ROOT/$file"
  if [ ! -f "$filepath" ]; then
    echo "  スキップ (ファイルなし): $file"
    continue
  fi

  if grep -q "$CURRENT_NAME" "$filepath"; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|$CURRENT_NAME|$NEW_NAME|g" "$filepath"
    else
      sed -i "s|$CURRENT_NAME|$NEW_NAME|g" "$filepath"
    fi
    echo "  置換完了: $file"
    CHANGED=$((CHANGED + 1))
  else
    echo "  変更なし: $file"
  fi
done

echo ""
echo "=========================================="
echo "完了: ${CHANGED} ファイルを更新しました。"
echo "=========================================="
echo ""
echo "次のステップ:"
echo "  1. devcontainer を再ビルドしてください (Rebuild Container)"
echo "  2. 必要に応じて CLAUDE.md の内容をプロジェクトに合わせて編集してください"
