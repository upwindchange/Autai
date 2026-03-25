#!/bin/bash
git submodule foreach 'branch=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed "s|origin/||"); git checkout ${branch:-main} && git pull'
