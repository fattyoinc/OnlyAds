jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
// React Native Testing Library: let React flush updates inside act().
global.IS_REACT_ACT_ENVIRONMENT = true;
