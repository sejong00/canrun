# 커뮤니티 소개 글 초안 (2026-10-01)

게시는 본인 계정으로만(`docs/04` §8 ⑥). 올리기 전에 각 커뮤니티의 홍보 규정을 확인하고, 숫자는 사이트에서 한 번 더 확인한다(데이터가 매주 바뀐다).

---

## 1. 아카라이브 AI 로컬 채널 (한국어)

**제목**: 내 그래픽카드로 어떤 로컬 LLM이 돌아가는지 계산해 주는 사이트 만들어 봤어요

**본문**

새 모델이 나올 때마다 "12GB로 돌아가요?", "8GB면 뭐 돌려요?" 같은 질문이 계속 올라오길래, GPU 이름만 넣으면 돌릴 수 있는 모델을 정리해 주는 사이트를 만들어 봤어요.

https://canrunllm.com/ko

무료고 가입도 없어요. 계산은 전부 브라우저 안에서 해요.

GPU나 맥 칩을 고르면 모델마다 이런 걸 보여 줘요.
- 돌아가는지, 돌아가면 얼마나 쓸 만한지 (쾌적 / 원활 / 겨우 가능 / 불가)
- 어떤 양자화 파일을 받으면 되는지, 메모리는 얼마나 드는지
- 예상 속도(tok/s)를 한 숫자가 아니라 범위로
- 그 설정 그대로 쓰는 llama.cpp·Ollama 명령

몇 가지 예를 들면요. (시스템 RAM은 DDR5-5600 32GB 기준)
- RTX 4060 8GB: Llama 3.1 8B Q4_K_M이 VRAM에 전부 올라가요. 공개된 벤치마크로는 38 tok/s 정도예요.
- RTX 3060 12GB: Qwen3.6 35B-A3B는 전문가 일부를 RAM에 두는 방식(`--n-cpu-moe`)으로 돌리면 49 tok/s 안팎(35~64)으로 추정돼요.
- RTX 5060 Ti 16GB: gpt-oss-20b가 전부 올라가고, 공개된 벤치마크로는 111.6 tok/s예요.
- RTX 3090: Qwen3.8 27B Q4_K_M이 36 tok/s 안팎(32~41)으로 추정돼요.

숫자를 믿을 수 있게 하는 데 제일 신경 썼어요. 속도마다 "실측 / 보정된 추정 / 이론 추정" 라벨과 오차 범위를 붙였어요. 공개 벤치마크랑 비교해서 얼마나 맞았는지는 계산 방법 페이지에 그대로 공개해 뒀어요.
https://canrunllm.com/ko/methodology

목록에 없는 모델도 Hugging Face 주소(예: Qwen/Qwen3-4B)를 넣으면 같은 방식으로 계산해 줘요. 3090 두 장처럼 같은 GPU를 여러 장 꽂은 구성도 계산할 수 있어요(베타).

컨텍스트 길이나 KV 캐시 양자화를 바꾸면 메모리가 어떻게 변하는지도 볼 수 있어요. 가이드도 몇 개 써 뒀어요(VRAM별로 돌아가는 모델, Ollama 컨텍스트 설정, GGUF 양자화 고르는 법, 한국 모델 정리 등).

부탁드리고 싶은 건 이거예요.
- 숫자가 이상하면 알려 주세요. 직접 재신 속도가 있으면 모델·양자화·컨텍스트·GPU·RAM도 같이 적어 주시면 비교해서 반영할게요.
- 찾는 모델이나 GPU가 없으면 말씀해 주세요.

댓글이나 turbojenm@gmail.com으로 편하게 주세요.

---

## 2. r/LocalLLaMA (English)

**Title**: I built a calculator that tells you which local LLMs your GPU can run, with error ranges and the benchmarks behind them

**Body**

Every time a new model drops, the same questions show up: will it run on 12GB? What's the best I can do on 8GB? So I built a site that answers that for a given GPU or Mac.

https://canrunllm.com

Free, no sign-up, and everything is calculated in your browser.

Pick a GPU or Apple chip and for each model it shows:
- whether it fits and how usable it is (Runs great / Runs well / Runs slowly / Won't run)
- which quant to download and how much memory it needs (real GGUF file sizes, KV cache for your context length)
- a speed range rather than a single number, labeled measured / calibrated / theoretical
- ready-to-run llama.cpp and Ollama commands, including `--n-cpu-moe` for MoE models
- any model that isn't in the list: paste a Hugging Face link (original or GGUF repo) and it runs the same calculation in your browser
- multiple identical GPUs (e.g. 2×3090, beta): VRAM adds up, speed stays close to one card with layer split

A few examples (assuming 32GB of DDR5-5600 system RAM):
- RTX 4060 8GB: Llama 3.1 8B Q4_K_M fits fully, about 38 tok/s from a public measurement.
- RTX 3060 12GB: Qwen3.6 35B-A3B with some expert layers in system RAM, estimated at 49 tok/s (range 35–64).
- RTX 5060 Ti 16GB: gpt-oss-20b fits fully, 111.6 tok/s measured.
- RTX 3090: Qwen3.8 27B Q4_K_M, estimated at 36 tok/s (range 32–41).

The part I cared about most is being honest about accuracy. Speed estimates start from memory bandwidth and are calibrated against public llama.cpp numbers; the methodology page lists the error against those benchmarks and where the model is known to be off.
https://canrunllm.com/methodology

Feedback I'd love:
- numbers that look wrong, ideally with your own tg results (model, quant, context, GPU, RAM)
- models or GPUs you'd like added

(Disclosure: this is my project.)

---

## 올릴 때 참고
- 아카라이브: 채널 공지의 홍보·자작 규정 확인. 스크린샷 1장(계산기 결과 화면)을 붙이면 반응이 좋다.
- r/LocalLLaMA: 자기 프로젝트 홍보 규정(자기 링크 비율) 확인, 플레어는 "Resources" 또는 규정에 맞는 것. 미국 오전(한국 밤 10시~자정) 게시가 무난하다.
- 첫 몇 시간 댓글에 답하는 게 중요하다. 숫자 지적이 오면 캡처해서 알려 주면 확인·반영한다.
