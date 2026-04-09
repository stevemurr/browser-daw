.PHONY: all test test-c test-js clean

CC            = clang
CFLAGS        = -O0 -g -Wall -Wextra -Iengine -Iengine/vendor/unity \
                -fprofile-instr-generate -fcoverage-mapping
LLVM_PROFDATA = xcrun llvm-profdata
LLVM_COV      = xcrun llvm-cov

ENGINE_SRCS = engine/engine.c engine/track.c engine/eq.c \
              engine/compressor.c engine/distortion.c engine/limiter.c \
              engine/delay.c engine/chorus.c engine/reverb.c
UNITY_SRC   = engine/vendor/unity/unity.c
BUILD_DIR   = build

# Source files to measure — excludes test harness and vendored unity
COV_SRCS = engine/engine.c engine/track.c engine/eq.c \
           engine/compressor.c engine/distortion.c engine/limiter.c \
           engine/delay.c engine/chorus.c engine/reverb.c

# ── Build targets ────────────────────────────────────────────────────────────

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/test-engine: engine/test_engine.c $(ENGINE_SRCS) $(UNITY_SRC) | $(BUILD_DIR)
	$(CC) $(CFLAGS) $^ -lm -o $@

$(BUILD_DIR)/test-seek: engine/test_seek.c $(ENGINE_SRCS) $(UNITY_SRC) | $(BUILD_DIR)
	$(CC) $(CFLAGS) $^ -lm -o $@

# ── Test targets ─────────────────────────────────────────────────────────────

test-c: $(BUILD_DIR)/test-engine $(BUILD_DIR)/test-seek
	@echo "--- engine tests ---"
	@LLVM_PROFILE_FILE=$(BUILD_DIR)/engine.profraw $(BUILD_DIR)/test-engine
	@echo "--- seek tests ---"
	@LLVM_PROFILE_FILE=$(BUILD_DIR)/seek.profraw $(BUILD_DIR)/test-seek
	@$(LLVM_PROFDATA) merge -sparse \
	    $(BUILD_DIR)/engine.profraw \
	    $(BUILD_DIR)/seek.profraw \
	    -o $(BUILD_DIR)/coverage.profdata
	@echo ""
	@echo "--- coverage ---"
	@$(LLVM_COV) report \
	    $(BUILD_DIR)/test-engine \
	    -object $(BUILD_DIR)/test-seek \
	    -instr-profile=$(BUILD_DIR)/coverage.profdata \
	    $(COV_SRCS)

test-js:
	@echo "--- typescript tests ---"
	@npm test

test: test-c test-js

# ── Housekeeping ─────────────────────────────────────────────────────────────

clean:
	rm -rf $(BUILD_DIR)
