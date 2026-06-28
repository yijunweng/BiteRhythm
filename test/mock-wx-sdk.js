// test/mock-wx-sdk.js

class MockDb {
  constructor() {
    this.collections = {
      system_config: [],
      families: [],
      family_members: [],
      dishes: [],
      menus: []
    };
    this.command = {
      gte: (val) => ({
        type: 'gte',
        val,
        and: (other) => ({ type: 'between', gte: val, lt: other.val })
      }),
      lt: (val) => ({ type: 'lt', val }),
      in: (arr) => ({ type: 'in', arr }),
      inc: (val) => ({ type: 'inc', val })
    };
    // 跟踪操作次数
    this.opsCount = {
      get: 0,
      set: 0,
      update: 0,
      add: 0,
      remove: 0
    };
  }

  resetOpsCount() {
    this.opsCount = { get: 0, set: 0, update: 0, add: 0, remove: 0 };
  }

  serverDate() {
    return new Date();
  }

  collection(name) {
    if (!this.collections[name]) {
      this.collections[name] = [];
    }
    const dbInstance = this;
    const dataList = this.collections[name];

    const matchQuery = (item, query) => {
      for (let k in query) {
        const qVal = query[k];
        const itemVal = item[k];
        if (qVal && typeof qVal === 'object' && qVal.type) {
          if (qVal.type === 'in') {
            if (!qVal.arr.includes(itemVal)) return false;
          } else if (qVal.type === 'between') {
            if (itemVal < qVal.gte || itemVal >= qVal.lt) return false;
          } else if (qVal.type === 'gte') {
            if (itemVal < qVal.val) return false;
          } else if (qVal.type === 'lt') {
            if (itemVal >= qVal.val) return false;
          }
        } else {
          if (itemVal !== qVal) return false;
        }
      }
      return true;
    };

    return {
      doc: (id) => {
        return {
          get: async () => {
            dbInstance.opsCount.get++;
            const found = dataList.find(x => x._id === id);
            if (!found) {
              const err = new Error(`document ${id} not found`);
              err.errCode = -1;
              throw err;
            }
            return { data: JSON.parse(JSON.stringify(found)) };
          },
          set: async ({ data }) => {
            dbInstance.opsCount.set++;
            const index = dataList.findIndex(x => x._id === id);
            const copy = JSON.parse(JSON.stringify(data));
            copy._id = id;
            if (index !== -1) {
              dataList[index] = copy;
            } else {
              dataList.push(copy);
            }
            return { success: true };
          },
          update: async ({ data }) => {
            dbInstance.opsCount.update++;
            const found = dataList.find(x => x._id === id);
            if (!found) throw new Error(`document ${id} not found for update`);
            for (let k in data) {
              if (data[k] && data[k].type === 'inc') {
                found[k] = (found[k] || 0) + data[k].val;
              } else {
                found[k] = data[k];
              }
            }
            return { success: true };
          },
          remove: async () => {
            dbInstance.opsCount.remove++;
            const index = dataList.findIndex(x => x._id === id);
            if (index !== -1) {
              dataList.splice(index, 1);
            }
            return { success: true, stats: { removed: index !== -1 ? 1 : 0 } };
          }
        };
      },
      where: (query) => {
        let filtered = dataList.filter(item => matchQuery(item, query));
        const chain = {
          limit: (n) => {
            filtered = filtered.slice(0, n);
            return chain;
          },
          skip: (n) => {
            filtered = filtered.slice(n);
            return chain;
          },
          get: async () => {
            dbInstance.opsCount.get++;
            return { data: JSON.parse(JSON.stringify(filtered)) };
          },
          remove: async () => {
            dbInstance.opsCount.remove++;
            let removedCount = 0;
            for (let item of filtered) {
              const idx = dataList.findIndex(x => x._id === item._id);
              if (idx !== -1) {
                dataList.splice(idx, 1);
                removedCount++;
              }
            }
            return { success: true, stats: { removed: removedCount } };
          }
        };
        return chain;
      },
      add: async ({ data }) => {
        dbInstance.opsCount.add++;
        const copy = JSON.parse(JSON.stringify(data));
        if (!copy._id) {
          copy._id = 'mock_id_' + Math.random().toString(36).substr(2, 9);
        }
        dataList.push(copy);
        return { _id: copy._id, success: true };
      }
    };
  }
}

// 模拟的 wx-server-sdk 实例
const mockSdk = {
  DYNAMIC_CURRENT_ENV: 'mock-env',
  init: () => {},
  
  // 模拟当前 openid 和上下文，允许在测试中动态更新
  openid: 'mock_user_openid',
  appid: 'mock_appid',
  unionid: 'mock_unionid',
  
  getWXContext() {
    return {
      OPENID: this.openid,
      APPID: this.appid,
      UNIONID: this.unionid,
      ENV: 'mock-env'
    };
  },

  dbInstance: new MockDb(),
  database() {
    return this.dbInstance;
  }
};

module.exports = mockSdk;
