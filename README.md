# coding-pet

Claude Code でコーディングするほど育つペット。卵から生まれ、作業で解除した実績を経験値にして成長し、できることが増えていきます。

*A pet for Claude Code that hatches from an egg and grows on the achievements you unlock while coding. Open it with `/pet`. The UI is in Japanese.*

```
 [ホーム] [実績] [できること] [せってい]
╭──────────────────────────────────────╮
│ たま                     猫・子ども  │
│ (ドット絵)   年齢   3日目             │
│              誕生日 10/5              │
│              XP     120 / 250         │
│ ──────────────────────────────────── │
│ おなか   ■■■□□   きげん ■■■■□       │
│ なかよし ■■□□□   成長   ■□□□□ →大人 │
│ [ごはん 2/3] [なでる 5/5] [あそぶ 3/3]│
│ ──────────────────────────────────── │
│ いま: ごきげん！                      │
│ きょうのできごと                      │
│   12:03 コミットしてよろこんだ         │
╰──────────────────────────────────────╯
```

## できること

- **育つ**: 実績を解除すると XP が入り、卵 → 赤ちゃん → 子ども → 大人 → 完全体と成長します。種族（猫・鳥・スライム・ドラゴン・おばけ）は孵化したときに決まります
- **実績**: 全17個。名前は見えますが、解除の条件は解除するまで秘密です
- **できることが増える**: 成長するとお祝い、効果音、AI おしゃべりなどが解禁されます
- **お世話**: ごはん・なでる・あそぶで、おなか・きげん・なかよし度が上がります（1日の回数に上限あり、XP は入りません）
- **ドット絵**: ターミナルでは 16×16 のドット絵で表示します（それ以外では顔文字）
- **日記**: きょうのできごとを記録します

## 動作条件

- Claude Code **2.1.289** 以降で動作を確認しています
- この mod は Claude Code の関数フック（mods）で作られています。関数フックは **early access** の機能で、Claude Code の版によって API が変わり、動かなくなることがあります
- ドット絵と効果音はターミナル（macOS）向けです。デスクトップアプリなどでは顔文字で表示されます

## インストール

Claude Code の中で:

```
/plugin marketplace add ytskmt14/coding-pet
/plugin install coding-pet@coding-pet
```

インストール後、新しいセッションで `/pet` を開いてください。使い方は `/pet help` で見られます。

| コマンド | 内容 |
|---|---|
| `/pet` | ペインを開く（数字キー 1〜3 でお世話、4〜7 でタブ切り替え） |
| `/pet name <名前>` | 名前を変える |
| `/pet switch <種族>` | 種族を変える（成長はそのまま） |
| `/pet sound on\|off` | 効果音の切り替え |
| `/pet chatter on\|off` | AI おしゃべりの切り替え |
| `/pet preview <段階> <種族>` | 見た目だけ試す（`/pet preview off` で戻る） |
| `/pet help` | ヘルプ |

## データとプライバシー

- 育成データは、Claude Code の設定ディレクトリの `plugins/store/` にある `coding-pet` で始まる JSON ファイルに保存されます。外部には送りません
- ペットが数えるのは、ツールの使用回数・ターン数・コミットやテストの回数・エラーの回数・支出（`/cost` と同じ値）などの**件数だけ**です。プロンプトの本文、コマンド、ファイルのパスは保存も送信もしません（「ありがとう」を言ったかどうかの判定にだけプロンプトを見ます）
- 日記に書くのは決まった文言だけです
- **AI おしゃべり**（完全体で解禁）だけは、ペットの一言を作るために小さなモデル（Haiku）を最短1分に1回呼びます。送るのは種族・ペットの名前・気分・件数で、あなたの Claude Code の利用枠（トークン）を少し使います。`/pet chatter off` で止められます

## アンインストール

```
/plugin uninstall coding-pet@coding-pet
/plugin marketplace remove coding-pet
```

育成データも消したい場合は、設定ディレクトリの `plugins/store/` にある `coding-pet` で始まる JSON ファイルを削除してください。

## 開発

```
claude plugin validate plugins/coding-pet
claude plugin test plugins/coding-pet
claude --plugin-dir plugins/coding-pet     # ソースから読み込んで試す
```

- `plugins/coding-pet/tsconfig.json` は、Claude Code が mod を読み込んだときに `.claude-plugin/types/` に置く型定義を参照します。一度読み込んだあとに `npx tsc -p plugins/coding-pet` で型チェックできます
- 効果音は `node scripts/gen-sounds.mjs plugins/coding-pet/sounds` で作り直せます（依存なし、毎回同じファイルになります）

## ライセンス

MIT
